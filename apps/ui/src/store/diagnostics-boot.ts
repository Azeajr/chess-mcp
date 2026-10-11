// Imported first by the entry point, so faults raised while the other modules load are recorded too.
import { installFaultCapture, restoreDiagnostics } from "./diagnostics";

installFaultCapture();
void restoreDiagnostics();
