function(properties, context) {
  var auth = {
    user: context.keys["Token ID"].replace(/\s/g, "").replace("Bearer", ""),
    pass: context.keys["Token Secret"].replace(/\s/g, "").replace("Bearer", "")
  };

  var getSubmissionOptions = {
    method: "GET",
    uri: `https://api.docspring.com/api/v1/submissions/${properties.submissionId}`,
    auth: auth
  };

  var getResponse = context.request(getSubmissionOptions);
  if (!getResponse || !getResponse.body) {
    console.log(
      "Error fetching submission! Response:",
      getResponse.statusCode,
      getResponse.body
    );
    return {
      success: false,
      errorMessage: `Could not fetch submission with id: ${submission.id}`
    };
  }
  // The request library doesn't automatically parse the JSON from this response,
  // so we have to do it manually.
  submission = JSON.parse(getResponse.body);

  console.log("Returning submission:", submission);
  return {
    success: true,
    id: submission.id,
    state: submission.state,
    file: submission.download_url,
    permanentFile: submission.permanent_download_url,
    errorMessage: null
  };
}
