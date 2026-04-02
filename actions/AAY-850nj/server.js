async function(properties, context) {
  if (!context.keys["Token ID"] || !context.keys["Token Secret"]) {
    throw new Error(
      "Please go to Plugins => 'DocSpring - Fill and Generate PDFs', " +
      "then fill in the 'Token ID' and 'Token Secret' fields with your " +
      "API token ID and secret. You can create a new API token here: " +
      "https://app.docspring.com/api_tokens"
    );
  }

  const US_URL = "https://api.docspring.com/api/v1";
  const EU_URL = "https://api-eu.docspring.com/api/v1";
  const AU_URL = "https://api-au.docspring.com/api/v1";

  const auth = {
    user: context.keys["Token ID"].replace(/\s/g, "").replace(/Bearer/i, ""),
    pass: context.keys["Token Secret"].replace(/\s/g, "").replace(/Bearer/i, "")
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

  const getSubmissionOptions = {
    method: "GET",
    uri: `${apiBaseUrl}/submissions/${properties.submissionId}`,
    auth: auth
  };

  const getResponse = await context.v3.request(getSubmissionOptions);

  if (!getResponse || !getResponse.body) {
    console.log(
      "Error fetching submission! Response:",
      getResponse && getResponse.statusCode,
      getResponse && getResponse.body
    );

    return {
      success: false,
      errorMessage: `Could not fetch submission with id: ${properties.submissionId}`,
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
      errorMessage: `Could not parse fetch submission response: ${error.message}`,
      regionInfo: serializedRegionInfo,
      response: JSON.stringify(getResponse && getResponse.body)
    };
  }

  const submission = parsedBody.submission || parsedBody;

  if (!submission || !submission.id) {
    console.log(
      "Invalid submission response! Response:",
      getResponse && getResponse.statusCode,
      getResponse && getResponse.body
    );

    return {
      success: false,
      errorMessage: `Could not fetch submission with id: ${properties.submissionId}`,
      regionInfo: serializedRegionInfo,
      response: JSON.stringify(getResponse && getResponse.body)
    };
  }

  return {
    success: true,
    id: submission.id,
    state: submission.state,
    file: submission.download_url,
    permanentFile: submission.permanent_download_url,
    errorMessage: null,
    processedAt: submission.processed_at,
    pdfHash: submission.pdf_hash,
    templateId: submission.template_id,
    isTest: submission.test,
    expiresAt: submission.expires_at,
    password: submission.password,
    regionInfo: serializedRegionInfo,
    response: JSON.stringify(submission)

  };
}