import fs from "fs";
import { OpenAPIClientAxios } from "openapi-client-axios";

const credentials = JSON.parse(fs.readFileSync(process.env.APPLICATION_CREDENTIALS));

const BUDGEA_HOST = credentials.budgea.host;
const BUDGEA_CLIENT_ID = credentials.budgea.client_id;
const BUDGEA_CLIENT_SECRET = credentials.budgea.client_secret;
export const BUDGEA_REDIRECT_URI = (process.env.HOST ?? "https://localhost:5000") + "/callback/budgea";

export async function getApi(user) {
  let axiosConfigDefaults = {
    baseURL: BUDGEA_HOST,
  };
  if (user && user.budgea) {
    axiosConfigDefaults.headers = {
      Authorization: `Bearer ${user.budgea.access_token}`,
    };
  }
  const api = new OpenAPIClientAxios({
    definition: "./budget-insight/openapi.yaml",
    axiosConfigDefaults,
  });
  return await api.getClient();
  /*
  const client = new ApiClient(BUDGEA_HOST);
  client.authentications.apiKey = {
    client_id: BUDGEA_CLIENT_ID,
    client_secret: BUDGEA_CLIENT_SECRET,
  };

  if (user && user.budgea) {
    client.authentications.apiKey.Authorization = user["budgea"]["access_token"];
    client.authentications.apiKey.apiKeyPrefix.Authorization = user["budgea"]["access_token_type"];
  }
*/
}

export const getBanksMap = async () =>
  Object.fromEntries(
    await getApi()
      .then((client) => client.paths["/banks"].get())
      .then((r) => r.data.banks)
      .then((banks) => banks.map((b) => [b.id, b]))
  );
