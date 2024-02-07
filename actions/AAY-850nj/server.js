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

  var getSubmissionOptions = {
    method: "GET",
    uri: `https://api.docspring.com/api/v1/submissions/${properties.submissionId}`,
    auth: auth
  };

    
  var getResponse = await context.v3.request(getSubmissionOptions);

  if (
    !getResponse ||
    !getResponse.body
  ) {
	console.log(
      "Error fetching submission! Response:",
      getResponse.statusCode,
      getResponse.body
    );
    return {
      success: false,
      errorMessage: `Could not fetch submission with id: ${properties.submissionId}`
    };
  }
  // The request library doesn't automatically parse the JSON from this response,
  // so we have to do it manually.
  var submission = JSON.parse(getResponse.body);

  console.log("Returning submission:", submission);
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
    
  };
}
