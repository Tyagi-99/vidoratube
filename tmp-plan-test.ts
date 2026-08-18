import { planProject } from "./src/lib/studio.server";
const script = "In 1066, William of Normandy crossed the Channel. Harold Godwinson marched south after Stamford Bridge. On 14 October the two armies met near Hastings. By dusk Harold was dead and England had a new king.";
try {
  const plan = await planProject({ topic: "Battle of Hastings", script, mode: "stock", preset: "documentary", category: null, language: "English", durationMinutes: 2, style: "cinematic" });
  console.log("OK", plan.title, plan.scenes.length);
} catch (e) { console.log("FAIL", (e as Error).message); }
