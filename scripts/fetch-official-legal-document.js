"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fetchOfficialLegalDocument } = require("../lib/legal-official-fetch");

async function main() {
  const sourceUrl = process.argv[2];
  const outputPath = process.argv[3];
  if (!sourceUrl || !outputPath) {
    console.error("روش استفاده: node scripts/fetch-official-legal-document.js <official-https-url> <output-file>");
    process.exitCode = 2;
    return;
  }
  const destination = path.resolve(process.cwd(), outputPath);
  let result;
  try {
    result = await fetchOfficialLegalDocument(sourceUrl);
    fs.writeFileSync(destination, result.bytes, { flag: "wx", mode: 0o600 });
    process.stdout.write(JSON.stringify(result.metadata, null, 2) + "\n");
    console.error("سند دریافت شد؛ تعداد صفحات و تطبیق حقوقی هنوز باید جداگانه بررسی شوند.");
  } catch (error) {
    if (result) {
      try { fs.unlinkSync(destination); } catch {}
    }
    console.error("دریافت رسمی سند تأیید نشد: " + error.message);
    process.exitCode = 1;
  }
}

main();
