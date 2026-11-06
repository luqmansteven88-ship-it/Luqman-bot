module.exports = {
  botName: 'LUQMAN X MD',
  ownerName: 'LUQMAN SJ',
  ownerNumber: '255678716839',
  prefix: '.',
  stickerPack: 'LUQMAN X MD',
  // Tanzania = UTC+3 (used by .remind for times like 18:30)
  utcOffset: 3,
  mongoUri:
    process.env.MONGODB_URI ||
    'mongodb+srv://luqmansteven88_db_user:luqman17@cluster0.epsc00l.mongodb.net/',
  dbName: 'luqmanxmd',
};
