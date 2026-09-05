import {
  StrategicFitIntentError,
  diffStrategicFitProfiles,
  resolveStrategicFitIntentPatch,
  strategicFitIntentErrorResult,
  type StrategicFitIntentProposalInput,
  type StrategicFitProfile,
  type StrategicFitProfileDiffEntry,
  type StrategicFitProfileMode,
} from "@chess-mcp/chess-tools";
import { createSignal } from "solid-js";
import { documentId, version } from "./game";
import { strategicFitAnalysisSettings } from "./strategic-fit-resolutions";
import {
  normalizeStrategicFitProfilePreferences,
  selectStrategicFitProfile,
  strategicFitPresetProfile,
  strategicFitProfile,
  strategicFitProfileIdentity,
  updateCustomStrategicFitProfile,
  type StrategicFitProfileMutationResult,
} from "./strategic-fit-profile";

type StrategicFitProposalStatus = "pending" | "accepted" | "rejected" | "stale";

interface StrategicFitStagedProfileProposal {
  readonly proposal_id: string;
  readonly status: StrategicFitProposalStatus;
  readonly document_id: string;
  readonly repertoire_revision: number;
  readonly profile_identity: string;
  readonly settings_identity: string;
  readonly current_mode: StrategicFitProfileMode;
  readonly resulting_mode: StrategicFitProfileMode;
  readonly resulting_profile: StrategicFitProfile;
  readonly preset_only: boolean;
  readonly confirms_provisional_profile: boolean;
  readonly diff: readonly StrategicFitProfileDiffEntry[];
  readonly rationale: string | null;
  readonly created_at: string;
}

export interface StrategicFitProfileProposalResult {
  readonly kind: "strategic_fit_profile_proposal";
  readonly proposal_id: string;
  readonly status: "pending";
  readonly revision: number;
  readonly current_mode: StrategicFitProfileMode;
  readonly resulting_mode: StrategicFitProfileMode;
  readonly confirms_provisional_profile: boolean;
  readonly diff: readonly StrategicFitProfileDiffEntry[];
  readonly rationale: string | null;
  readonly persisted: false;
  readonly scope: "profile-preferences-only";
  readonly next_step: string;
}

type StrategicFitProposalDecisionResult =
  | {
      readonly ok: true;
      readonly proposal_id: string;
      readonly status: StrategicFitProposalStatus;
      readonly mode: StrategicFitProfileMode;
    }
  | { readonly ok: false; readonly error: string; readonly reason: string };

export interface StrategicFitIntentInterviewBoundary {
  currentDocumentId(): string;
  currentRevision(): number;
  currentProfile(): StrategicFitProfile;
  currentSettingsIdentity(): string;
  selectProfile(mode: StrategicFitProfileMode): StrategicFitProfileMutationResult;
  updateCustom(preferences: StrategicFitProfile["preferences"]): StrategicFitProfileMutationResult;
  now(): string;
}

export interface StrategicFitIntentInterviewState {
  proposals(): readonly StrategicFitStagedProfileProposal[];
  proposal(proposalId: string): StrategicFitStagedProfileProposal | undefined;
  propose(input: StrategicFitIntentProposalInput): StrategicFitProfileProposalResult;
  accept(proposalId: string): StrategicFitProposalDecisionResult;
  reject(proposalId: string): StrategicFitProposalDecisionResult;
}

function staleReason(
  proposal: StrategicFitStagedProfileProposal,
  boundary: StrategicFitIntentInterviewBoundary,
): string | null {
  if (proposal.document_id !== boundary.currentDocumentId()) return "A different document is open.";
  if (proposal.repertoire_revision !== boundary.currentRevision())
    return "The repertoire changed after this proposal was made.";
  if (proposal.profile_identity !== strategicFitProfileIdentity(boundary.currentProfile())) {
    return "The Strategic Fit profile changed after this proposal was made.";
  }
  if (proposal.settings_identity !== boundary.currentSettingsIdentity()) {
    return "Strategic Fit analysis settings changed after this proposal was made.";
  }
  return null;
}

function assertConceptPreferencesDoNotConflict(profile: StrategicFitProfile): void {
  const preferred = new Set(profile.preferences.preferred_concept_ids);
  const overlap = profile.preferences.avoided_concept_ids.filter((concept) =>
    preferred.has(concept),
  );
  if (overlap.length === 0) return;
  throw new StrategicFitIntentError(
    "strategic_fit_intent_conflicting_concepts",
    `${overlap.join(", ")} cannot be preferred and avoided at the same time. Ask the user which one they meant instead of choosing for them.`,
  );
}

export function createStrategicFitIntentInterviewState(
  boundary: StrategicFitIntentInterviewBoundary,
): StrategicFitIntentInterviewState {
  const [proposals, setProposals] = createSignal<readonly StrategicFitStagedProfileProposal[]>([]);
  let nextId = 1;

  const update = (proposalId: string, status: StrategicFitProposalStatus) =>
    setProposals((all) =>
      all.map((entry) => (entry.proposal_id === proposalId ? { ...entry, status } : entry)),
    );

  const find = (proposalId: string) =>
    proposals().find((entry) => entry.proposal_id === proposalId);

  return {
    proposals,
    proposal: find,

    propose(input) {
      const patch = resolveStrategicFitIntentPatch(input);
      const current = boundary.currentProfile();
      const presetOnly = patch.mode !== null && !patch.touches_preferences;
      const basePreferences =
        patch.mode === null
          ? current.preferences
          : strategicFitPresetProfile(patch.mode).preferences;
      const resulting: StrategicFitProfile = presetOnly
        ? strategicFitPresetProfile(patch.mode)
        : {
            ...current,
            mode: "custom",
            source: "explicit",
            provisional: false,
            preferences: normalizeStrategicFitProfilePreferences(
              patch.preferences ?? {},
              basePreferences,
            ),
          };
      assertConceptPreferencesDoNotConflict(resulting);
      const diff = diffStrategicFitProfiles(current, resulting);
      const confirmsProvisional = current.provisional || current.source === "inferred";
      if (diff.length === 0 && !confirmsProvisional) {
        throw new StrategicFitIntentError(
          "strategic_fit_intent_no_change",
          "The proposed profile is identical to the confirmed one. Tell the user their profile already matches instead of asking them to confirm nothing.",
        );
      }
      const proposal: StrategicFitStagedProfileProposal = {
        proposal_id: `strategic-fit-profile-proposal:${nextId++}`,
        status: "pending",
        document_id: boundary.currentDocumentId(),
        repertoire_revision: boundary.currentRevision(),
        profile_identity: strategicFitProfileIdentity(current),
        settings_identity: boundary.currentSettingsIdentity(),
        current_mode: current.mode,
        resulting_mode: resulting.mode,
        resulting_profile: resulting,
        preset_only: presetOnly,
        confirms_provisional_profile: confirmsProvisional,
        diff,
        rationale: patch.rationale,
        created_at: boundary.now(),
      };
      setProposals((all) => [...all, proposal]);
      return {
        kind: "strategic_fit_profile_proposal",
        proposal_id: proposal.proposal_id,
        status: "pending",
        revision: proposal.repertoire_revision,
        current_mode: proposal.current_mode,
        resulting_mode: proposal.resulting_mode,
        confirms_provisional_profile: proposal.confirms_provisional_profile,
        diff: proposal.diff,
        rationale: proposal.rationale,
        persisted: false,
        scope: "profile-preferences-only",
        next_step:
          "Nothing has been saved. Summarize the difference and let the user accept or reject it in the application; never state that the profile changed until they do.",
      };
    },

    accept(proposalId) {
      const proposal = find(proposalId);
      if (proposal?.status !== "pending") {
        return {
          ok: false,
          error: "strategic_fit_intent_proposal_not_pending",
          reason: proposal
            ? `This proposal was already ${proposal.status}.`
            : "That profile proposal is not available in this session.",
        };
      }
      const stale = staleReason(proposal, boundary);
      if (stale) {
        update(proposalId, "stale");
        return {
          ok: false,
          error: "strategic_fit_intent_proposal_stale",
          reason: `${stale} Propose the change again against the current profile so the user sees an accurate difference.`,
        };
      }
      const result = proposal.preset_only
        ? boundary.selectProfile(proposal.resulting_mode)
        : boundary.updateCustom(proposal.resulting_profile.preferences);
      if (result.state !== "updated") {
        update(proposalId, "stale");
        return {
          ok: false,
          error: "strategic_fit_intent_proposal_stale",
          reason: `The profile state did not apply this proposal (${result.state}); propose the change again against the current profile.`,
        };
      }
      update(proposalId, "accepted");
      return { ok: true, proposal_id: proposalId, status: "accepted", mode: result.profile.mode };
    },

    reject(proposalId) {
      const proposal = find(proposalId);
      if (proposal?.status !== "pending") {
        return {
          ok: false,
          error: "strategic_fit_intent_proposal_not_pending",
          reason: proposal
            ? `This proposal was already ${proposal.status}.`
            : "That profile proposal is not available in this session.",
        };
      }
      update(proposalId, "rejected");
      return { ok: true, proposal_id: proposalId, status: "rejected", mode: proposal.current_mode };
    },
  };
}

const browserIntentInterview = createStrategicFitIntentInterviewState({
  currentDocumentId: documentId,
  currentRevision: version,
  currentProfile: strategicFitProfile,
  currentSettingsIdentity: () => strategicFitAnalysisSettings().identity,
  selectProfile: (mode) => selectStrategicFitProfile(mode),
  updateCustom: (preferences) => updateCustomStrategicFitProfile(preferences),
  now: () => new Date().toISOString(),
});

export const strategicFitProfileProposal = (proposalId: string) =>
  browserIntentInterview.proposal(proposalId);
export const acceptStrategicFitProfileProposal = (proposalId: string) =>
  browserIntentInterview.accept(proposalId);
export const rejectStrategicFitProfileProposal = (proposalId: string) =>
  browserIntentInterview.reject(proposalId);

export function proposeStrategicFitProfile(
  input: StrategicFitIntentProposalInput,
): StrategicFitProfileProposalResult | { readonly error: string; readonly reason: string } {
  try {
    return browserIntentInterview.propose(input);
  } catch (error) {
    return strategicFitIntentErrorResult(error);
  }
}
