'use strict';
const app = require('./api/app');
const { DB_PATH } = require('./db');
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`The Long Game — API + client on http://localhost:${port}`);
  console.log(`DB: ${DB_PATH}${process.env.LG_NOW ? `  (demo clock ${process.env.LG_NOW})` : ''}`);
});
