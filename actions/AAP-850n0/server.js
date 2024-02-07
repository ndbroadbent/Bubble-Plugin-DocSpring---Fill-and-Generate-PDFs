async function(properties, context) {
  if (!context.keys["Token ID"] || !context.keys["Token Secret"]) {
    throw new Error("Please go to Plugins => 'DocSpring - Fill and Generate PDFs', " + 
                    "then fill in the 'Token ID' and 'Token Secret' fields with your " + 
                   "API token ID and secret. You can create a new API token here: " +
                   "https://app.docspring.com/api_tokens");
  }

  var auth = {
    user: context.keys["Token ID"].replace(/\s/g, "").replace("Bearer", ""),
    pass: context.keys["Token Secret"].replace(/\s/g, "").replace("Bearer", "")
  };

  var createSubmissionOptions = {
    method: "POST",
    uri: `https://api.docspring.com/api/v1/templates/${properties.templateId}/submissions`,
    auth: auth,
    json: {
      test: properties.test,
      data: {}
    }
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

    // Set up any nested arrays and objects if field name includes slashes
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
      cursor[parseInt(lastKeyPart)] = value;
    } else {
      cursor[lastKeyPart] = value;
    }
  });

  console.log(`Creating submission for template ${properties.templateId}...`);
  // The request library automatically parses the JSON from the response.
  var createResponse = await context.v3.request(createSubmissionOptions);

  if (
    !createResponse ||
    !createResponse.body ||
    !createResponse.body.submission
  ) {
    console.log(
      "Error creating submission! Response:",
      createResponse.statusCode,
      createResponse.body
    );
    return {
      success: false,
      errorMessage: "Could not create submission.",
      response: JSON.stringify(createResponse.body)
    };
  }
  var submission = createResponse.body.submission;
  var getSubmissionURL = `https://api.docspring.com/api/v1/submissions/${submission.id}`;

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
        getResponse.statusCode,
        getResponse.body
      );
      return {
        success: false,
        errorMessage: `Could not fetch submission with id: ${submission.id}. URL: ${getSubmissionURL}`
      };
    }
    // The request library doesn't automatically parse the JSON from this response,
    // so we have to do it manually.
    submission = JSON.parse(getResponse.body);

    retryCount = retryCount + 1;
    if (retryCount > 45) {
      return {
        success: false,
        errorMessage: "Timeout: Submission was not processed after 45 seconds."
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
    response: JSON.stringify(submission)
  };

  console.log("Returning result:", result);
  return result;
}