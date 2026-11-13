// Converts the fieldwork procedures in docs/ into the structured library the audit engine loads.
// The markdown documents are the source of truth: edit them, then run `npm run methodology`.
import { writeFileSync } from "node:fs";
import { buildLibrary } from "./methodology-parser";

const library = buildLibrary();
writeFileSync("src/domain/methodology-library.json", JSON.stringify(library, null, 2) + "\n");
const count = library.areas.reduce((n, a) => n + a.procedures.length, 0);
const steps = library.checklists.reduce((n, c) => n + c.items.length, 0);
console.log(`wrote src/domain/methodology-library.json: ${library.areas.length} areas, ${count} procedures; ${library.checklists.length} checklists, ${steps} steps`);
