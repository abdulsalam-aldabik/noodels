import { ScanPipeline } from "./ScanPipeline";

let shared: ScanPipeline | null = null;

/** Returns the app-wide shared ScanPipeline instance, creating it on first call. */
export function getSharedPipeline(): ScanPipeline {
  if (!shared) shared = new ScanPipeline();
  return shared;
}
