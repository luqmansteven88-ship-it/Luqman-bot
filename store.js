const { MongoClient } = require('mongodb');
const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const cfg = require('./config');

let db;
const cache = { settings: null, groups: new Map() };

async function connect() {
  const client = new MongoClient(cfg.mongoUri);
  await client.connect();
  db = client.db(cfg.dbName);
  console.log('MongoDB connected');
  return db;
}

const col = (n) => db.collection(n);

// ---------- WhatsApp session in MongoDB ----------
async function useMongoAuthState() {
  const auth = col('auth');
  const write = (data, id) =>
    auth.replaceOne({ _id: id }, { _id: id, v: JSON.stringify(data, BufferJSON.replacer) }, { upsert: true });
  const read = async (id) => {
    const d = await auth.findOne({ _id: id });
    return d ? JSON.parse(d.v, BufferJSON.reviver) : null;
  };
  const remove = (id) => auth.deleteOne({ _id: id });

  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,