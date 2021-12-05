import express from "express";
import { loadUser } from "./user.js";
import { getAccounts, loadBudget, init } from "@actual-app/api";
import { getApi, getBanksMap } from "./budget_insight.js";
const app = express();
app.set("views", "./templates");
app.set("view engine", "ejs");

app.get("/bank-callback", (req, res) => {});

app.get("/connect", (req, res) => {});

const banksMap = await getBanksMap();
/*
banks_map = {
    b.id: b for b in banks_api.banks_get().banks
}
*/

await init();
app.get("/", async (req, res) => {
  const user = await loadUser();
  let budget;
  if (user.actual) {
  }

  console.log("loadBudget");
  await loadBudget("Budget-8496122");
  console.log("getAccounts");
  const accounts = await getAccounts();
  budget = {
    accounts: accounts.filter((a) => !a.closed),
  };
  const actualAccountsMap = {};
  budget.accounts.forEach((account) => {
    actualAccountsMap[account.id] = account;
  });

  let connections = [];
  const accountMap = {};
  if (user.budgea) {
    const client = await getApi(user);
    const connectionsResponse = await client.paths["/users/{id_user}/connections"].get("me");

    connections = await Promise.all(
      connectionsResponse.data.connections.map(async (connection) => {
        const accountsResponse = await client.paths["/users/{id_user}/connections/{id_connection}/accounts"].get({
          id_user: "me",
          id_connection: String(connection.id),
        });
        const accounts = accountsResponse.data.accounts;

        accounts.forEach((account) => {
          accountMap[account.id] = { account, bank: banksMap[connection.id_bank] };
        });
        return {
          connector: banksMap[connection.id_connector],
          connection,
          accounts,
        };
      })
    );
  }

  let mapping = [];
  for (let mapping_item of user.mapping ?? []) {
    console.log(mapping_item);
    const { account, bank } = accountMap[mapping_item.budgea];
    const actualAccount = actualAccountsMap[mapping_item.actual];
    mapping.push({
      ...mapping_item,
      accountName: `${bank.name} ${account.name}`,
      actualAccountName: actualAccount.name,
    });
  }
  const opts = {
    budget,
    connections,
    mapping,
  };
  console.log(opts);
  return res.render("index", opts);
});

export async function main() {
  const port = 5000;
  app.listen(port, () => {
    console.log("Server app listening on port " + port);
  });
}
