import { documentCommands } from "./document";
import { gameCommands } from "./game";
import { positionCommands } from "./position";
import { repertoireCommands } from "./repertoire";
import type { BrowserCommandRegistry } from "./types";

/** Source registrations remain visible so inventory checks can detect duplicate names before spread overwrite. */
export const browserCommandRegistrations = [positionCommands, documentCommands, gameCommands, repertoireCommands]
  .flatMap((group) => Object.entries(group));

/** Actual browser implementation inventory. Canonical contracts describe; these keys execute. */
export const browserCommandImplementations: BrowserCommandRegistry = {
  ...positionCommands,
  ...documentCommands,
  ...gameCommands,
  ...repertoireCommands,
};

export const browserImplementationNames = () => Object.keys(browserCommandImplementations).sort();
