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

  var getSubmissionOptions = {
    method: "GET",
    uri: `${api_base_url}/submissions/${properties.submissionId}`,
    auth: auth
  };

  var getResponse = await context.v3.request(getSubmissionOptions);

  if (!getResponse || !getResponse.body) {
    console.log(
      "Error fetching submission! Response:",
      getResponse && getResponse.statusCode,
      getResponse && getResponse.body
    );
    return {
      success: false,
      errorMessage: `Could not fetch submission with id: ${properties.submissionId}`,
      apiBaseUrl: api_base_url,
      response: JSON.stringify(getResponse && getResponse.body)
    };
  }

  // The Bubble request library returns a raw string body for GET requests
  // (unlike POST with the `json` option), so we parse it manually.
  var submission = JSON.parse(getResponse.body);

  console.log("Returning submission:", submission);
  return {
    success: true,
    id: submission.id,
    state: submission.state,
    file: submission.download_url,
    permanentFile: submission.permanent_download_url,
    errorMessage: null,
    apiBaseUrl: api_base_url,
    response: JSON.stringify(submission),
    processedAt: submission.processed_at,
    pdfHash: submission.pdf_hash,
    templateId: submission.template_id,
    isTest: submission.test,
    expiresAt: submission.expires_at,
    password: submission.password
  };
}
