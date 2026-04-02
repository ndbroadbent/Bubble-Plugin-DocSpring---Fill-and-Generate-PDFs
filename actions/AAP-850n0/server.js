async function(properties, context) {
  if (!context.keys["Token ID"] || !context.keys["Token Secret"]) {
    throw new Error(
      "Please go to Plugins => 'DocSpring - Fill and Generate PDFs', " +
      "then fill in the 'Token ID' and 'Token Secret' fields with your " +
      "API token ID and secret. You can create a new API token here: " +
      "https://app.docspring.com/api_tokens"
    );
  }

  const MAX_POLL_ATTEMPTS = 45;
  const POLL_INTERVAL_MS = 1000;
  const US_URL = "https://api.docspring.com/api/v1";
  const EU_URL = "https://api-eu.docspring.com/api/v1";
  const AU_URL = "https://api-au.docspring.com/api/v1";

  const auth = {
    user: context.keys["Token ID"].replace(/\s/g, "").replace(/Bearer/i, ""),
    pass: context.keys["Token Secret"].replace(/\s/g, "").replace(/Bearer/i, "")
  };

  const validateMetadata = (metadata) => {
    if (!Array.isArray(metadata)) return metadata;
    return metadata.reduce((obj, { key, value }) => ({ ...obj, [key]: value }), {});
  };

  const parseResponseBody = (body) => {
    if (typeof body === "string") {
      return JSON.parse(body);
    }
    return body;
  };

  const resolveApiRegion = (input) => {
    const raw = String(input || "").trim();
    const normalized = raw.toUpperCase();

    if (!raw || normalized === "US") {
      return {
        apiBaseUrl: US_URL,
        region: "US",
        usedFallback: false,
        warningMessage: null
      };
    }

    if (normalized === "EU") {
      return {
        apiBaseUrl: EU_URL,
        region: "EU",
        usedFallback: false,
        warningMessage: null
      };
    }

    if (normalized === "AU") {
      return {
        apiBaseUrl: AU_URL,
        region: "AU",
        usedFallback: false,
        warningMessage: null
      };
    }

    try {
      const url = new URL(raw);

      if (url.protocol === "http:" || url.protocol === "https:") {
        return {
          apiBaseUrl: raw.replace(/\/+$/, ""),
          region: "CUSTOM",
          usedFallback: false,
          warningMessage: null
        };
      }

      return {
        apiBaseUrl: US_URL,
        region: "US",
        usedFallback: true,
        warningMessage:
          `Invalid Region setting "${input}". Unsupported URL protocol ` +
          `"${url.protocol}". Defaulted to US server.`
      };
    } catch {
      return {
        apiBaseUrl: US_URL,
        region: "US",
        usedFallback: true,
        warningMessage:
          `Invalid Region setting "${input}". Expected US, EU, AU, or a full ` +
          `http(s) API URL. Defaulted to US server.`
      };
    }
  };

  const regionInfo = resolveApiRegion(context.keys["Region"]);
  const serializedRegionInfo = JSON.stringify(regionInfo);
  const apiBaseUrl = regionInfo.apiBaseUrl;

  if (regionInfo.warningMessage) {
    console.warn(regionInfo.warningMessage);
  }

  const createSubmissionOptions = {
    method: "POST",
    uri: `${apiBaseUrl}/templates/${properties.templateId}/submissions`,
    auth: auth,
    json: {
      test: properties.test,
      metadata: validateMetadata(properties.metadata),
      data: {}
    }
  };

  const dataItems = Array.isArray(properties.data) ? properties.data : [];

  dataItems.forEach((item) => {
    if (!item || !item.key) {
      return;
    }

    const value =
      properties.parseAsBoolean &&
      (item.value === "true" || item.value === "false")
        ? item.value === "true"
        : item.value;

    const keyParts = item.key.split("/");
    let cursor = createSubmissionOptions.json.data;

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
        throw new Error(
          `Invalid data path "${item.key}": expected array at "${previousKeyPart}".`
        );
      } else if (
        !shouldBeArray &&
        (typeof existingValue !== "object" || Array.isArray(existingValue))
      ) {
        throw new Error(
          `Invalid data path "${item.key}": expected object at "${previousKeyPart}".`
        );
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

  const createResponse = await context.v3.request(createSubmissionOptions);

  let createBody;
  try {
    createBody = parseResponseBody(createResponse && createResponse.body);
  } catch (error) {
    return {
      success: false,
      errorMessage: `Could not parse create submission response: ${error.message}`,
      regionInfo: serializedRegionInfo,
      response: JSON.stringify(createResponse && createResponse.body)
    };
  }

  if (!createBody || !createBody.submission) {
    console.log(
      "Error creating submission! Response:",
      createResponse && createResponse.statusCode,
      createResponse && createResponse.body
    );

    return {
      success: false,
      errorMessage: "Could not create submission.",
      regionInfo: serializedRegionInfo,
      response: JSON.stringify(createResponse && createResponse.body)
    };
  }

  let submission = createBody.submission;
  const getSubmissionUrl = `${apiBaseUrl}/submissions/${submission.id}`;

  const getSubmissionOptions = {
    method: "GET",
    uri: getSubmissionUrl,
    auth: auth
  };

  let retryCount = 0;
  while (submission.state === "pending") {
    console.log(
      `Waiting 1s before polling for submission status (${submission.id})...`
    );

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const getResponse = await context.v3.request(getSubmissionOptions);
    if (!getResponse || !getResponse.body) {
      console.log(
        "Error fetching submission! Response:",
        getResponse && getResponse.statusCode,
        getResponse && getResponse.body
      );
      return {
        success: false,
        errorMessage: `Could not fetch submission when polling with id: ${submission.id}. URL: ${getSubmissionUrl}`,
        regionInfo: serializedRegionInfo,
        response: JSON.stringify(getResponse && getResponse.body)
      };
    }

    let parsedBody;
    try {
      parsedBody = parseResponseBody(getResponse.body);
    } catch (error) {
      return {
        success: false,
        errorMessage: `Could not parse submission polling response: ${error.message}`,
        regionInfo: serializedRegionInfo,
        response: JSON.stringify(getResponse && getResponse.body)
      };
    }

    submission = parsedBody.submission || parsedBody;

    retryCount += 1;
    if (retryCount > MAX_POLL_ATTEMPTS) {
      return {
        success: false,
        errorMessage: `Timeout: Submission was not processed after ${MAX_POLL_ATTEMPTS} seconds.`,
        regionInfo: serializedRegionInfo,
        response: JSON.stringify(submission)
      };
    }
  }

  return {
    success: submission.state === "processed",
    id: submission.id,
    state: submission.state,
    file: submission.download_url,
    permanentFile: submission.permanent_download_url,
    errorMessage: null,
    response: JSON.stringify(submission),
    regionInfo: serializedRegionInfo
  };
}