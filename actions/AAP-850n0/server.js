async function(properties, context) {
  if (!context.keys["Token ID"] || !context.keys["Token Secret"]) {
    throw new Error(
      "Please go to Plugins => 'DocSpring - Fill and Generate PDFs', " +
      "then fill in the 'Token ID' and 'Token Secret' fields with your " +
      "API token ID and secret. You can create a new API token here: " +
      "https://app.docspring.com/api_tokens"
    );
  }

  // Strip whitespace and "Bearer" prefix from credentials, since users
  // sometimes paste the full Authorization header value by mistake.
  var auth = {
    user: context.keys["Token ID"].replace(/\s/g, "").replace("Bearer", ""),
    pass: context.keys["Token Secret"].replace(/\s/g, "").replace("Bearer", "")
  };

  const validateMetadata = (metadata) => {
    if (!Array.isArray(metadata)) return metadata;
    return metadata.reduce((obj, { key, value }) => ({ ...obj, [key]: value }), {});
  };

  // Resolve the user's Region plugin setting to an API base URL.
  // Accepts "US" (default), "EU", "AU", or a full http(s) URL for
  // custom/self-hosted endpoints. Invalid values fall back to US
  // with a warning message.
  function resolveApiRegion(input) {
    const raw = String(input || "").trim();
    const normalized = raw.toUpperCase();

    const US_URL = "https://api.docspring.com/api/v1";
    const EU_URL = "https://api-eu.docspring.com/api/v1";
    const AU_URL = "https://api-au.docspring.com/api/v1";

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
          unusedKey: "somedata",
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
  }

  const regionInfo = resolveApiRegion(context.keys["Region"]);
  var api_base_url = regionInfo.apiBaseUrl;

  if (regionInfo.warningMessage) {
    console.warn(regionInfo.warningMessage);
  }

  var createSubmissionOptions = {
    method: "POST",
    uri: `${api_base_url}/templates/${properties.templateId}/submissions`,
    auth: auth,
    json: {
      test: properties.test,
      metadata: validateMetadata(properties.metadata),
      data: {},
    },
  };

  properties.data.forEach(item => {
    var value;
    if (
      properties.parseAsBoolean &&
      (item.value === "true" || item.value === "false")
    ) {
      value = item.value === "true";
    } else {
      value = item.value;
    }

    if (!item.key) {
      return;
    }

    var keyParts = item.key.split("/");
    var cursor = createSubmissionOptions.json.data;

    keyParts.forEach(function(keyPart, i) {
      if (i === 0) {
        return;
      }

      var previousKeyPart = keyParts[i - 1];
      if (/^[0-9]+$/.test(keyPart)) {
        cursor[previousKeyPart] = cursor[previousKeyPart] || [];
      } else {
        cursor[previousKeyPart] = cursor[previousKeyPart] || {};
      }
      cursor = cursor[previousKeyPart];
    });

    var lastKeyPart = keyParts[keyParts.length - 1];
    if (Array.isArray(cursor)) {
      cursor[parseInt(lastKeyPart, 10)] = value;
    } else {
      cursor[lastKeyPart] = value;
    }
  });

  console.log(`Creating submission for template ${properties.templateId}...`);

  var createResponse = await context.v3.request(createSubmissionOptions);

  if (
    !createResponse ||
    !createResponse.body ||
    !createResponse.body.submission
  ) {
    console.log(
      "Error creating submission! Response:",
      createResponse && createResponse.statusCode,
      createResponse && createResponse.body
    );

    return {
      success: false,
      errorMessage: "Could not create submission.",
      apiBaseUrl: api_base_url,
      response: JSON.stringify(createResponse && createResponse.body)
    };
  }

  var submission = createResponse.body.submission;
  var getSubmissionURL = `${api_base_url}/submissions/${submission.id}`;

  var getSubmissionOptions = {
    method: "GET",
    uri: getSubmissionURL,
    auth: auth
  };

  var retryCount = 0;
  while (submission.state === "pending") {
    console.log(
      `Waiting 1s before polling for submission status (${submission.id})...`
    );

    await new Promise(resolve => setTimeout(resolve, 1000));

    var getResponse = await context.v3.request(getSubmissionOptions);
    if (!getResponse || !getResponse.body) {
      console.log(
        "Error fetching submission! Response:",
        getResponse && getResponse.statusCode,
        getResponse && getResponse.body
      );
      return {
        success: false,
        errorMessage: `Could not fetch submission with id: ${submission.id}. URL: ${getSubmissionURL}`,
        apiBaseUrl: api_base_url
      };
    }

    // The Bubble request library returns a raw string body for GET requests
    // (unlike POST with the `json` option), so we parse it manually.
    submission = JSON.parse(getResponse.body);

    retryCount = retryCount + 1;
    if (retryCount > 45) {
      return {
        success: false,
        errorMessage: "Timeout: Submission was not processed after 45 seconds.",
        apiBaseUrl: api_base_url
      };
    }
  }

  var result = {
    success: submission.state === "processed",
    id: submission.id,
    state: submission.state,
    file: submission.download_url,
    permanentFile: submission.permanent_download_url,
    errorMessage: null,
    apiBaseUrl: api_base_url,
    response: JSON.stringify(submission)
  };

  console.log("Returning result:", result);
  return result;
}