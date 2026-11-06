/**
 * Example files that come with the app (copied from examples/ into the build by tools/copy-examples.mjs), so a
 * first-time user can open one without going to GitHub. Projects open like Open does; workbooks are downloads.
 */
export interface Example {
  file: string;
  title: string;
  about: string;
}

/** Projects: opened in the app. */
export const EXAMPLE_PROJECTS: Example[] = [
  {
    file: "example-downstream.pcs.json",
    title: "Downstream mAb process",
    about: "Protein A to frozen storage, seven unit operations: PFD with valves, Mass Balance applied (Sending 2,000 L and Receiving 15,000 L), BOM, materials and operation steps. Made-up numbers.",
  },
  {
    file: "example-process.pcs.json",
    title: "Small example (10 L → 100 L)",
    about: "Two unit operations and 18 materials, Mass Balance not applied yet: try uploading MB_example.xlsx on the Mass Balance screen.",
  },
];

/** Workbooks: downloaded, to look at or to upload/import on their screen. */
export const EXAMPLE_FILES: Example[] = [
  { file: "MB_downstream.xlsx", title: "MB workbook of the downstream example", about: "Calculation sheet and the PCS_LINK sheet the app reads (Mass Balance › Upload)." },
  { file: "MB_example.xlsx", title: "MB workbook of the small example", about: "Upload it on the Mass Balance screen of the small example." },
  { file: "downstream-materials.xlsx", title: "Material list to import", about: "Materials, Recipes and Backups sheets (Materials › Import Excel/CSV)." },
  { file: "operations-downstream.xlsx", title: "Operation steps and valve actions", about: "Equipment, Steps and Actions sheets (Operations › Import from Excel…)." },
];

export const exampleUrl = (file: string) => `${import.meta.env.BASE_URL}examples/${encodeURIComponent(file)}`;
