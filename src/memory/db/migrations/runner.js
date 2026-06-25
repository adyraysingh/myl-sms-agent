'use strict';
const fs=require('fs'),path=require('path'),pool=require('../pool');
async function runMigrations(){
  const dir=path.join(__dirname);
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
  console.log('[migrations] Running',files.length,'files');
  for(const file of files){
    const sql=fs.readFileSync(path.join(dir,file),'utf8');
    try{await pool.query(sql);console.log('[migrations] Done:',file);}
    catch(err){console.error('[migrations] Failed:',file,err.message);throw err;}
  }
  console.log('[migrations] Complete');
}
module.exports={runMigrations};
