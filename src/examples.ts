/**
 * Example files that come with the app (copied from examples/ into the build by tools/copy-examples.mjs), so a
 * first-time user can open one without going to GitHub. Projects open like Open does; workbooks are downloads.
 */
export interface Example {
  file: string;
  title: string;
  about: string;
  /** A project example's id and last change as in its file (test/examples.test.ts keeps them in step). */
  projectId?: string;
  updatedAt?: string;
}

/** Projects: opened in the app. */
export const EXAMPLE_PROJECTS: Example[] = [
  {
    file: "example-downstream.pcs.json",
    title: "Downstream mAb process",
    projectId: "prj_mvyjubth02f0hx",
    updatedAt: "2026-11-04T09:13:52.425Z",
    about: "Protein A to frozen storage, seven unit operations: PFD with valves, Mass Balance applied (Sending 2,000 L and Receiving 15,000 L), BOM, materials and operation steps. Made-up numbers.",
  },
  {
    file: "example-process.pcs.json",
    title: "Small example (10 L → 100 L)",
    projectId: "prj_mvubgbje02e6e7",
    updatedAt: "2026-10-30T01:51:52.215Z",
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

/**
 * An example exactly as it comes with the app (opened before N5.5, when an example became the autosaved project,
 * and never changed): nothing of the user's is in it, so on the first start of N5.5 the app starts with an empty
 * project instead (once per browser: an example opened on purpose later stays).
 */
export const isUntouchedExample = (p: { id: string; meta: { updatedAt: string } }) =>
  EXAMPLE_PROJECTS.some((e) => e.projectId === p.id && e.updatedAt === p.meta.updatedAt);
