import fs from "fs";
import faunadb from "faunadb";
const q = faunadb.query;

console.log("credentials: ", process.env.APPLICATION_CREDENTIALS);
const credentials = JSON.parse(
  fs.readFileSync(process.env.APPLICATION_CREDENTIALS)
);

const client = new faunadb.Client({ secret: credentials.faunadb.secret });
const USER_ID = credentials.user_id;
const REF = q.Ref(q.Collection("user_data"), USER_ID);

export async function loadUser() {
  return (await client.query(q.Get(REF))).data;
}

export function saveUser(user) {
  client.query(q.update(REF, { data: user }));
}
