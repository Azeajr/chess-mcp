import { documentCommands } from "./document";
import { gameCommands } from "./game";
import { positionCommands } from "./position";
import { repertoireCommands } from "./repertoire";
import type { BrowserCommandRegistry } from "./types";
import type { GameTree, Path, StrategicFitDocumentMetadata } from "@chess-mcp/chess-tools";

export const browserCommandRegistrations = [
  positionCommands,
  documentCommands,
  gameCommands,
  repertoireCommands,
].flatMap((group) => Object.entries(group));

export const browserCommandImplementations: BrowserCommandRegistry = {
  ...positionCommands,
  ...documentCommands,
  ...gameCommands,
  ...repertoireCommands,
};

export const browserDocumentMutationRegistry = {
  strategic_fit_change_set: {
    publish: (
      input: {
        readonly tree: GameTree;
        readonly metadata: StrategicFitDocumentMetadata;
        readonly navigation: Path;
        readonly expected_revision: number;
      },
      publish: (input: {
        readonly tree: GameTree;
        readonly metadata: StrategicFitDocumentMetadata;
        readonly navigation: Path;
        readonly expected_revision: number;
      }) =>
        | { readonly ok: true; readonly revision: number }
        | { readonly ok: false; readonly error: string },
    ) => publish(input),
    rollback: (
      input: {
        readonly tree: GameTree;
        readonly metadata: StrategicFitDocumentMetadata;
        readonly navigation: Path;
        readonly revision: number;
        readonly dirty: boolean;
      },
      rollback: (input: {
        readonly tree: GameTree;
        readonly metadata: StrategicFitDocumentMetadata;
        readonly navigation: Path;
        readonly revision: number;
        readonly dirty: boolean;
      }) => void,
    ) => {
      rollback(input);
    },
  },
} as const;
