import fs from "fs";
import { fileURLToPath } from "url";
import { ArgumentParser } from "argparse";
import sgMail from "@sendgrid/mail";
import dateutil from "dateutil";
import os from "os";
import path from "path";
import { loadUser, saveUser } from "./user.js";
import { getApi, getBanksMap } from "./budget_insight.js";
import { importTransactions, getAccounts, init, loadBudget, q, runQuery, getTransactions } from "@actual-app/api";
import winston from "winston";

const tmpLogs = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-log-send-to-"));
const tmpLog = path.join(tmpLogs, "tmp.log");

const plainFormat = winston.format.printf(({ level, message }) => message);

const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(plainFormat),
  transports: [new winston.transports.Console(), new winston.transports.File({ filename: tmpLog })],
});

const APPLICATION_CREDENTIALS = JSON.parse(fs.readFileSync(process.env.APPLICATION_CREDENTIALS));

sgMail.setApiKey(APPLICATION_CREDENTIALS.sendgrid.api_key);

async function sendEmail(user, subject, content) {
  const message = {
    from: APPLICATION_CREDENTIALS.sendgrid.from_email,
    to: user.email,
    subject,
    text: content,
  };
  try {
    const response = await sgMail.send(message);
    logger.debug(response.status_code);
    logger.debug(response.body);
    logger.debug(response.headers);
  } catch (err) {
    console.trace(err);
  }
}

function compress(s) {
  function uniqueList(l) {
    return Array.from(new Set(l));
  }

  s = uniqueList(s.split(" ")).join(" ");

  s = s.replaceAll(new RegExp("virement", "ig"), "vrt");
  s = s.replaceAll(new RegExp("prelevement", "ig"), "prlvt");
  return s;
}
/*
async function sendToActual(user, transactions, account_descr){
    budget_id = 'default'

    wrapper = SaveTransactionsWrapper(transactions=transactions)

    if wrapper.transactions:
        try:
            logger.debug('sending to YNAB...')
            response = transactions_api.create_transaction(
                budget_id=budget_id,
                data=wrapper
            )
            logger.debug(response.data)
        except ApiException as e:
            if e.status == 409 and e.reason == 'Conflict':
                print('OK this transaction has already been imported')
            elif e.status == 429 and e.reason == 'Too Many Requests':
                headers = e.headers
                pass
            else:
                raise
    else:
        logger.debug('nothing to send for %s' % account_descr)
}
*/
async function main(last_sync) {
  const user = await loadUser();
  logger.info("last_sync", last_sync);
  if (last_sync !== undefined) {
    user.last_sync = last_sync;
  } else {
    user.last_sync = user.last_sync.date;
  }

  const syncOK = await sendBudgea(user);

  if (syncOK) {
    user.last_sync = new DateTime();
    saveUser(user);
  }

  const logs = fs.readFileSync(tmpLog).toString("utf-8");
  //sendEmail(user, "Log", logs);
}

async function sendToActual(user, accountId, transactions, accountDescr) {
  let result = await importTransactions(accountId, transactions);
  console.log(result);
}

async function sendBudgea(user) {
  /*
    ynab_client = get_api_client(user)
    ynab_accounts_api = AccountsApi(ynab_client)
    budgets_api = BudgetsApi(ynab_client)
    budgets_api.get_budgets()
    connections_api = get_budgea_api(ConnectionsApi, user)
    banks_api = get_budgea_api(BanksApi, user)
    budget_id = 'default'
    */
  const client = await getApi(user);
  const connectionsResponse = await client.paths["/users/{id_user}/connections"].get("me");
  const banksMap = await getBanksMap();

  const connectionsMap = {};
  const accountsMap = {};
  const mapBudgea = {};

  await Promise.all(
    connectionsResponse.data.connections.map(async (connection) => {
      if (connection.error !== undefined) {
        logger.error(`error with connection ${JSON.stringify(connection)}`);
      }
      const accountsResponse = await client.paths["/users/{id_user}/connections/{id_connection}/accounts"].get({
        id_user: "me",
        id_connection: String(connection.id),
      });
      accountsResponse.data.accounts.forEach((account) => {
        mapBudgea[String(account.id)] = `${banksMap[connection.id_connector].name}|${account.name}`;
        connectionsMap[account.id] = connection;
        accountsMap[account.id] = account;
      });
    })
  );
  logger.debug("BUDGEA");
  Object.entries(accountsMap).forEach(([accountId, account]) => {
    logger.debug("%s %s %s", accountId, mapBudgea[String(accountId)], account.balance);
  });

  logger.debug("Actual");
  await init();
  await loadBudget("Budget-8496122");
  let accounts = await getAccounts();
  const actualAccountsMap = {};
  for (let account of accounts) {
    if (account.closed) continue;
    logger.debug("%s %s %s", account.id, account.name, account.balance / 1000);
    actualAccountsMap[account.id] = account;
  }

  for (let mapped of user.mapping) {
    const budgeaAccountId = parseInt(mapped.budgea);
    const actualAccountId = mapped.actual;
    const connectionId = connectionsMap[budgeaAccountId].id;

    const getTxn = (transaction, importId) => {
      let memo = transaction.original_wording;
      if (memo.length > 50) {
        memo = compress(memo);
      }
      if (transaction.original_wording.length > 50) {
        memo = memo.substring(0, 50);
      }

      let payeeName = transaction.simplified_wording;
      if (payeeName.length > 50) {
        payeeName = compress(payeeName);
      }
      if (payeeName.length > 50) {
        payeeName = payeeName.substring(0, 50);
      }

      return {
        account: actualAccountId,
        amount: parseInt(transaction.value * 100),
        date: transaction.date,
        imported_id: importId,
        notes: memo,
        payee_name: payeeName,
      };
    };

    const getTxn2 = (transaction) => {
      const importId = `${connectionId}.${budgeaAccountId}.${transaction.id}`;
      return getTxn(transaction, importId);
    };

    const now = new Date();
    const timeFiltered = (transaction) => {
      return new Date(transaction.last_update) <= now;
    };

    let lastSyncMinus7days = new Date(user.last_sync);
    lastSyncMinus7days.setDate(lastSyncMinus7days.getDate() - 7);
    const transactionsResponse = await client.paths[
      "/users/{id_user}/connections/{id_connection}/accounts/{id_account}/transactions"
    ].get({
      id_user: "me",
      id_connection: connectionId,
      id_account: budgeaAccountId,
      min_date: lastSyncMinus7days.toISOString().split("T")[0],
    });
    const transactions = transactionsResponse.data.transactions.filter(timeFiltered).map(getTxn2);
    console.log(transactionsResponse);
    await sendToActual(user, actualAccountId, transactions, actualAccountsMap[actualAccountId].name);

    logger.info("balance verification...");
  }

  accounts = await getAccounts();
  for (let account of accounts) {
    if (account.closed) continue;
    logger.debug("%s %s %s", account.id, account.name, account.balance / 1000);
    actualAccountsMap[account.id] = account;
  }

  for (let mapped of user.mapping) {
    const budgeaAccountId = parseInt(mapped.budgea);
    const actualAccountId = mapped.actual;
    const connectionId = connectionsMap[budgeaAccountId].id;
    const balance = accountsMap[budgeaAccountId].balance;
    const actualAccount = actualAccountsMap[actualAccountId];
    const data = await getTransactions(actualAccountId);
    const actualBalance = data.reduce((prev, current) => prev + current.amount, 0) / 100;
    if (actualBalance !== balance) {
      logger.error("DESYNC API vs Actual");
      logger.error(balance, actualBalance);
    }
  }
  /*
    

    for mapped in user['mapping']:

        budgea_accounts = banks_api.users_id_user_connections_id_connection_accounts_get('me', connection_id)

        for budgea_account in budgea_accounts.accounts:
            if budgea_account.id == budgea_account_id:
                balance = budgea_account.balance
                ynab_balance = round(ynab_account.cleared_balance / 1000, 2)
                logger.info(tabulate([
                    ['', 'API', 'YNAB'],
                    [ynab_account.name, balance, ynab_balance]
                ]))
                if ynab_balance != balance:
                    logger.error('!!!DESYNC between API and YNAB')
                    logger.debug(raw_transactions)
                    # return False
                else:
                    logger.info('ok')
    return True

*/
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parser = new ArgumentParser();
  parser.add_argument("--last-sync", { type: dateutil.parse, default: undefined });
  const args = parser.parse_args();
  main(args.last_sync);
}
