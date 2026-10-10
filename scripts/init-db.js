const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
(async()=>{try { await pool.query(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8')); console.log('Banco FORMI preparado.'); } catch(e) { console.error(e.message); process.exitCode=1; } finally { await pool.end(); }})();
