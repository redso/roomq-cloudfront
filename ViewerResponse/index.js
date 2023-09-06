exports.handler = async (event) => {
  const response = event.Records[0].cf.response;
  const request = event.Records[0].cf.request;

  if (request.headers["set-cookie"]) {
    response.headers["set-cookie"] = response.headers["set-cookie"] || [];
    response.headers["set-cookie"].push({
      key: "Set-Cookie",
      value: request.headers["set-cookie"][0].value,
    });
  }

  if (request.headers["X-NOQ-CLIENT"]) {
    response.headers["X-NOQ-CLIENT"] = request.headers["X-NOQ-CLIENT"];
  }

  if (request.headers["X-NOQ-SKIP"]) {
    response.headers["X-NOQ-SKIP"] = request.headers["X-NOQ-SKIP"];
  }

  if (request.headers["X-NOQ-ROOM"]) {
    response.headers["X-NOQ-ROOM"] = request.headers["X-NOQ-ROOM"];
  }

  return response;
};
