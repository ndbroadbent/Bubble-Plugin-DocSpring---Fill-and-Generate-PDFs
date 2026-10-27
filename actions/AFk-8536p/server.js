async function(properties, context) {
  // ---- DocSpring plugin helpers ----
  // Bubble actions can't share modules, so every action's server.js starts with
  // this same block. Keep it identical in every action (test/structure.test.js
  // checks; test/support/sync-helpers.js copies it from Create PDF Submission).
  const PLUGIN_VERSION = "2.0.0";
  const PREVIOUS_PLUGIN_VERSION = "1.7.0";
  const USER_AGENT = "docspring-bubble/" + PLUGIN_VERSION;
  // Polling waits 1, 2, 4, then 8 seconds between requests, up to 45 seconds
  // of waiting in all (so actions fit in Bubble's time limit).
  const POLL_WAITS_MS = [1000, 2000, 4000, 8000];
  const MAX_POLL_WAIT_MS = 45000;
  const REGION_URLS = {
    US: "https://api.docspring.com/api/v2",
    EU: "https://api-eu.docspring.com/api/v2"
  };
  const KNOWN_HOSTS = {
    "api.docspring.com": "US",
    "sync.api.docspring.com": "US",
    "api-eu.docspring.com": "EU",
    "sync.api-eu.docspring.com": "EU",
    "api-au.docspring.com": "AU",
    "sync.api-au.docspring.com": "AU"
  };
  const RECORD_IDS = [
    ["submission_id", "Submission", "The PDF", "Get PDF Submission", "submission.processed"],
    ["submission_batch_id", "Submission batch", "The batch", "Get Submission Batch", "submission_batch.processed"],
    ["combined_pdf_id", "Combined PDF", "The combined PDF", "Get Combined PDF", "combined_pdf.processed"],
    ["template_id", "Template", "The template's PDF", "Get Template", null]
  ];

  const keys = context.keys || {};
  if (!keys["Token ID"] || !keys["Token Secret"]) {
    throw new Error(
      "Please go to Plugins => 'DocSpring - Fill and Generate PDFs', " +
      "then fill in the 'Token ID' and 'Token Secret' fields with your " +
      "API token ID and secret. You can create a new API token here: " +
      "https://app.docspring.com/api_tokens"
    );
  }

  const auth = {
    user: String(keys["Token ID"]).replace(/\s/g, "").replace(/Bearer/i, ""),
    pass: String(keys["Token Secret"]).replace(/\s/g, "").replace(/Bearer/i, "")
  };

  const regionClosed = () => {
    throw new Error(
      "The AU region has closed. In the DocSpring plugin settings, set Region " +
      "to US (or leave it blank), EU, or your own DocSpring server's URL."
    );
  };

  const resolveApiRegion = (input) => {
    const raw = String(input || "").trim();
    const normalized = raw.toUpperCase();
    const named = (region) => ({
      apiBaseUrl: REGION_URLS[region],
      region: region,
      usedFallback: false,
      warningMessage: null
    });
    const fallback = (reason) => ({
      apiBaseUrl: REGION_URLS.US,
      region: "US",
      usedFallback: true,
      warningMessage: `Invalid Region setting "${input}". ${reason} Defaulted to US server.`
    });

    if (!raw || normalized === "US") return named("US");
    if (normalized === "EU") return named("EU");
    if (normalized === "AU") regionClosed();

    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    let url = null;
    try {
      url = new URL(raw.startsWith("//") ? "https:" + raw : hasScheme ? raw : "https://" + raw);
    } catch (error) {
      url = null;
    }
    const expected = "Expected US, EU, or the full URL of your DocSpring server.";
    if (!url) return fallback(expected);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback(`Unsupported URL protocol "${url.protocol}".`);
    }
    if (!hasScheme && !url.hostname.includes(".") && !url.port) return fallback(expected);

    const knownRegion = KNOWN_HOSTS[url.hostname];
    if (knownRegion === "AU") regionClosed();
    if (knownRegion) return named(knownRegion);

    // Self-hosted: the server's own URL, always on API v2. Users entered
    // these with /api/v1 for plugin 1.x.
    let basePath = url.pathname.replace(/\/+$/, "");
    if (/\/api\/v\d+$/i.test(basePath)) {
      basePath = basePath.replace(/\/api\/v\d+$/i, "/api/v2");
    } else if (/\/api$/i.test(basePath)) {
      basePath += "/v2";
    } else {
      basePath += "/api/v2";
    }
    return {
      apiBaseUrl: url.origin + basePath,
      region: "CUSTOM",
      usedFallback: false,
      warningMessage: null
    };
  };

  const regionInfo = resolveApiRegion(keys["Region"]);
  const apiBaseUrl = regionInfo.apiBaseUrl;
  if (regionInfo.warningMessage) {
    console.warn(regionInfo.warningMessage);
  }

  const isBlank = (value) =>
    value === undefined || value === null || (typeof value === "string" && value.trim() === "");

  // Trimmed text, or undefined when blank (blank optional inputs are left out).
  const optionalText = (value) => (isBlank(value) ? undefined : String(value).trim());

  const requiredText = (value, name) => {
    if (isBlank(value)) {
      throw new Error(`${name} is required.`);
    }
    return String(value).trim();
  };

  // Why an ID can't go into a URL path (blank, or "." or ".." which would
  // change the path), or null when it can.
  const pathIdProblem = (value, name) => {
    if (isBlank(value)) return `${name} is required.`;
    const text = String(value).trim();
    if (text === "." || text === "..") return `${name} can't be "${text}".`;
    return null;
  };

  // An ID for a URL path, encoded. Throws when it's blank, "." or "..".
  const pathId = (value, name) => {
    const problem = pathIdProblem(value, name);
    if (problem) throw new Error(problem);
    return encodeURIComponent(String(value).trim());
  };

  const toBoolean = (value, name) => {
    if (isBlank(value)) return undefined;
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (text === "true" || text === "yes") return true;
    if (text === "false" || text === "no") return false;
    throw new Error(`${name} must be yes or no, not "${value}".`);
  };

  const toInteger = (value, name) => {
    if (isBlank(value)) return undefined;
    const number = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(number)) {
      throw new Error(`${name} must be a whole number, not "${value}".`);
    }
    return number;
  };

  // A Bubble list, or text with one item per line or comma.
  const toList = (value) => {
    if (isBlank(value)) return [];
    const items = Array.isArray(value) ? value : String(value).split(/[\n,]/);
    return items
      .map((item) => (item === undefined || item === null ? "" : String(item).trim()))
      .filter((item) => item !== "");
  };

  const parseJsonInput = (value, name, kind) => {
    if (isBlank(value)) return undefined;
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        throw new Error(`${name} isn't valid JSON: ${error.message}`);
      }
    }
    if (kind === "array" && !Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON array, such as [{"name": "value"}].`);
    }
    if (kind === "object" && (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))) {
      throw new Error(`${name} must be a JSON object, such as {"name": "value"}.`);
    }
    return parsed;
  };

  const toIsoTime = (value, name) => {
    if (isBlank(value)) return undefined;
    const isDate = Object.prototype.toString.call(value) === "[object Date]";
    const numeric = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
    const date = isDate ? value : new Date(numeric);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${name} must be a date, not "${value}".`);
    }
    return date.toISOString();
  };

  // Bubble's file URLs can start with "//" (no protocol).
  const fileUrl = (value) => {
    const url = optionalText(value);
    if (url === undefined) return undefined;
    return url.startsWith("//") ? "https:" + url : url;
  };

  // A Bubble key/value list as an object, or undefined when it's empty.
  const keyValueObject = (list) => {
    if (list && typeof list === "object" && !Array.isArray(list)) {
      return Object.keys(list).length ? list : undefined;
    }
    const result = {};
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (item && !isBlank(item.key)) {
        result[String(item.key).trim()] = item.value;
      }
    });
    return Object.keys(result).length ? result : undefined;
  };

  // Submission data from a key/value list. "a/b/0" keys build nested objects
  // and lists. With parseAsBoolean, "true" and "false" become booleans.
  const buildData = (items, parseAsBoolean) => {
    const data = {};
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item || isBlank(item.key)) {
        return;
      }
      const key = String(item.key).trim();
      let value = item.value;
      if (parseAsBoolean && (value === "true" || value === "false")) {
        value = value === "true";
      }
      if (/(^|\/)url$/.test(key) && typeof value === "string" && value.trim().startsWith("//")) {
        value = "https:" + value.trim();
      }

      const keyParts = key.split("/");
      let cursor = data;
      keyParts.forEach((keyPart, i) => {
        if (i === 0) {
          return;
        }
        const previousKeyPart = keyParts[i - 1];
        const shouldBeArray = /^[0-9]+$/.test(keyPart);
        const existingValue = cursor[previousKeyPart];

        if (existingValue == null) {
          cursor[previousKeyPart] = shouldBeArray ? [] : {};
        } else if (shouldBeArray && !Array.isArray(existingValue)) {
          throw new Error(`Invalid data path "${key}": expected array at "${previousKeyPart}".`);
        } else if (!shouldBeArray && (typeof existingValue !== "object" || Array.isArray(existingValue))) {
          throw new Error(`Invalid data path "${key}": expected object at "${previousKeyPart}".`);
        }
        cursor = cursor[previousKeyPart];
      });

      const lastKeyPart = keyParts[keyParts.length - 1];
      if (Array.isArray(cursor)) {
        cursor[Number.parseInt(lastKeyPart, 10)] = value;
      } else {
        cursor[lastKeyPart] = value;
      }
    });
    return data;
  };

  // Sets body[name] unless the value is blank or an empty list.
  const put = (body, name, value) => {
    if (isBlank(value) || (Array.isArray(value) && value.length === 0)) {
      return body;
    }
    body[name] = value;
    return body;
  };

  const toJson = (value) => {
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? value : JSON.stringify(value);
  };

  const parseResponseBody = (body) => {
    if (typeof body !== "string") return body === undefined ? null : body;
    if (body.trim() === "") return null;
    try {
      return JSON.parse(body);
    } catch (error) {
      return body;
    }
  };

  const notReadyMessage = (what, getter, id, eventName) =>
    `${what} wasn't ready in time. Get it later with ${getter} (${id})` +
    (eventName ? `, or create a webhook for the ${eventName} event.` : ".");

  const stateFailureMessage = (what, state, errorMessage, idLabel, id) =>
    `${what} (state: ${state}): ${errorMessage || "no error message"}\n${idLabel}: ${id}`;

  // "Submission: sub_123" lines from [label, ID] pairs, skipping blank IDs and
  // lines already in lines.
  const recordLines = (records, lines) =>
    (records || [])
      .filter((record) => !isBlank(record[1]))
      .map((record) => `${record[0]}: ${record[1]}`)
      .filter((line) => !(lines || []).includes(line));

  // The lines after an API v2 error's message: its details, the IDs of the
  // records it saved or is about (with the caller's records), and the request
  // ID, last.
  const errorDetailLines = (error, records) => {
    const lines = [];
    (Array.isArray(error.details) ? error.details : []).forEach((detail) => {
      if (!detail) return;
      const where = detail.pointer || detail.parameter;
      lines.push(where ? `${where}: ${detail.message}` : String(detail.message));
    });
    RECORD_IDS.forEach((entry) => {
      if (error[entry[0]]) lines.push(`${entry[1]}: ${error[entry[0]]}`);
    });
    lines.push(...recordLines(records, lines));
    if (error.request_id) lines.push(`Request ID: ${error.request_id}`);
    return lines;
  };

  const formatApiError = (status, body, records) => {
    const error = body && typeof body === "object" && body.error && typeof body.error === "object" ? body.error : null;
    if (!error) {
      if (status === 404 && regionInfo.region === "CUSTOM") {
        return [
          "This DocSpring server doesn't have API v2 yet. Upgrade it to the latest " +
          `release, or use version ${PREVIOUS_PLUGIN_VERSION} of this plugin.`
        ].concat(recordLines(records)).join("\n");
      }
      const text = typeof body === "string" ? body : toJson(body);
      return [`DocSpring API error ${status}${text ? ": " + text.slice(0, 500) : ""}`]
        .concat(recordLines(records))
        .join("\n");
    }
    if (error.code === "polling_timeout") {
      const record = RECORD_IDS.find((entry) => error[entry[0]]);
      if (record) {
        const lines = [notReadyMessage(record[2], record[3], error[record[0]], record[4])];
        lines.push(...recordLines(records, [`${record[1]}: ${error[record[0]]}`]));
        if (error.request_id) lines.push(`Request ID: ${error.request_id}`);
        return lines.join("\n");
      }
    }
    return [`DocSpring API error ${status} ${error.code}: ${error.message}`]
      .concat(errorDetailLines(error, records))
      .join("\n");
  };

  // Calls API v2 and returns { ok, status, body, errorMessage }. Never throws
  // for HTTP errors. options.records ([label, ID] pairs, such as
  // ["Submission", "sub_123"]) name the records an error message is about.
  const apiRequest = async (method, path, options) => {
    const opts = options || {};
    const query = new URLSearchParams();
    Object.keys(opts.query || {}).forEach((name) => {
      const value = opts.query[name];
      if (!isBlank(value)) query.append(name, String(value));
    });
    const queryString = query.toString();
    const uri = apiBaseUrl + path + (queryString ? "?" + queryString : "");
    const requestOptions = {
      method: method,
      uri: uri,
      auth: auth,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      json: opts.body === undefined ? true : opts.body,
      simple: false
    };

    let response;
    try {
      response = await context.v3.request(requestOptions);
    } catch (error) {
      if (error && error.statusCode) {
        response = {
          statusCode: error.statusCode,
          headers: error.response && error.response.headers,
          body: error.error !== undefined ? error.error : error.response && error.response.body
        };
      } else {
        return {
          ok: false,
          status: null,
          headers: {},
          body: null,
          errorMessage: [`Could not reach DocSpring at ${uri}: ${error && error.message}`]
            .concat(recordLines(opts.records))
            .join("\n")
        };
      }
    }

    const status = response && response.statusCode;
    const headers = (response && response.headers) || {};
    const body = parseResponseBody(response && response.body);
    if (status >= 200 && status < 300) {
      return { ok: true, status: status, headers: headers, body: body, errorMessage: null };
    }
    return {
      ok: false,
      status: status,
      headers: headers,
      body: body,
      errorMessage: formatApiError(status, body, opts.records)
    };
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // A 429's Retry-After header in milliseconds, or null when it has none in
  // seconds.
  const retryAfterMs = (headers) => {
    const name = Object.keys(headers || {}).find((key) => key.toLowerCase() === "retry-after");
    const value = name === undefined ? "" : String(headers[name]).trim();
    return /^\d+$/.test(value) ? Number(value) * 1000 : null;
  };

  // Gets path until isDone(body), waiting 1, 2, 4, 8, 8, ... seconds between
  // requests, until MAX_POLL_WAIT_MS of waiting (the last wait is cut to fit).
  // A 429 waits for its Retry-After instead (at least a second), and stops
  // polling when that doesn't fit in the time left. Returns the last
  // apiRequest result with done: true, an error result with done: false, or,
  // when time runs out, done: false with the latest record (record, the one
  // being waited for, until a poll gets a newer one).
  const pollUntil = async (path, isDone, record) => {
    let latest = { ok: true, status: null, headers: {}, body: record, errorMessage: null };
    let waited = 0;
    let wait = Math.min(POLL_WAITS_MS[0], MAX_POLL_WAIT_MS);
    for (let poll = 1; wait > 0; poll += 1) {
      await sleep(wait);
      waited += wait;
      const left = MAX_POLL_WAIT_MS - waited;
      const backoff = Math.min(POLL_WAITS_MS[Math.min(poll, POLL_WAITS_MS.length - 1)], left);
      const result = await apiRequest("GET", path);
      if (result.status === 429) {
        const retryAfter = retryAfterMs(result.headers);
        if (retryAfter === null) {
          wait = backoff;
        } else {
          wait = Math.max(retryAfter, POLL_WAITS_MS[0]);
          if (wait > left) break;
        }
        continue;
      }
      if (result.ok && (!result.body || typeof result.body !== "object")) {
        result.ok = false;
        result.errorMessage = `DocSpring sent an unexpected response to GET ${path}: ${toJson(result.body)}`;
      }
      if (!result.ok) return Object.assign(result, { done: false });
      if (isDone(result.body)) return Object.assign(result, { done: true });
      latest = result;
      wait = backoff;
    }
    return Object.assign(latest, { done: false });
  };

  const fail = (errorMessage, response, extra) =>
    Object.assign({ success: false, errorMessage: errorMessage, response: toJson(response) }, extra || {});

  // One value per item (null when it has none), so Bubble's parallel lists
  // line up.
  const pluck = (items, read) => (Array.isArray(items) ? items : []).map((item) => {
    const value = item ? read(item) : undefined;
    return value === undefined ? null : value;
  });

  const pdfOf = (record) => (record && record.files && record.files.pdf) || {};

  const pageImagesOf = (record) => {
    const png = record && record.files && record.files.png;
    return png && Array.isArray(png.pages) ? png.pages.map((page) => page.download_url || null) : [];
  };
  // ---- end of DocSpring plugin helpers ----

  // Get Signature Request: GET /signature_requests/{id}.
  const signatureRequestId = pathId(properties.signatureRequestId, "Signature Request ID");

  const result = await apiRequest("GET", `/signature_requests/${signatureRequestId}`);
  if (!result.ok) {
    return fail(result.errorMessage, result.body);
  }

  const request = result.body || {};
  return {
    success: true,
    id: request.id,
    submissionId: request.submission_id || null,
    state: request.state,
    name: request.name || null,
    email: request.email || null,
    role: request.role || null,
    fields: Array.isArray(request.fields) ? request.fields : [],
    viewedAt: request.viewed_at || null,
    completedAt: request.completed_at || null,
    declinedAt: request.declined_at || null,
    errorMessage: null,
    response: toJson(request)
  };
}