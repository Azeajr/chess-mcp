# UX Review: Annotation Workflow

## Overview

Reviewed the annotation workflow using the ct-black-repertoire.pgn file. The annotation workflow allows users to add annotations (comments, intent) to moves in the repertoire.

## Findings

### Usability

- The annotation workflow is not immediately apparent from the main interface. The primary annotation-related buttons ("Annotated repertoire Generate") are located under the "Generate" group in the Analysis tab, but the button was unresponsive or not visible during testing.
- After clicking the generic "Generate" button, a "Cancel" button appeared along with "Generate metadata JSON" and "Generate intent PGN". It is unclear if these correspond to annotation functionality.
- The UI contains numerous buttons (over 30) which can cause cognitive overload and make it difficult to locate specific functions.

### Clarity

- Button labels are somewhat clear but could be more descriptive. For example, "Generate" is ambiguous; it triggers a submenu for annotation generation.
- The purpose of the "Generate metadata JSON" and "Generate intent PGN" buttons is not immediately clear without tooltips or documentation.
- The "Annotate PGN" button (expected for annotation) was not found in the interface.

### Error Handling

- No errors were encountered during the review session; the application remained stable.
- However, the timeout when attempting to click "Annotated repertoire Generate" suggests possible issues with button state or visibility that are not communicated to the user.

### Consistency

- The UI follows a consistent pattern of grouping related buttons under collapsible sections (e.g., Analysis, Moves, Chat, Prepare, Generate, Improve).
- Icon usage is minimal; most controls are text buttons, which aids consistency.
- The layout adapts to the mobile viewport (iPhone 13 Mini) but some buttons may be too small for touch interaction.

### Discoverability

- Discoverability of the annotation workflow is poor. Users must navigate to the Analysis tab, then look within the "Generate" group to find annotation-related actions.
- There is no obvious "Annotate" or "Add Annotation" button on the main toolbar or within the move list interface.
- The workflow relies on users understanding that annotation is a form of "generation" (metadata or intent PGN), which may not be intuitive.

## Ratings (out of 5)

- Usability: 2
- Clarity: 2
- Error Handling: 4 (no observed faults, but lack of feedback on failed interactions)
- Consistency: 4
- Discoverability: 2

## Actionable Recommendations

1. **Promote annotation controls**: Add a dedicated "Annotate" button or toolbar item that is visible in both Analysis and Moves tabs.
2. **Improve labeling**: Replace ambiguous buttons like "Generate" with more specific labels such as "Generate Annotations" or "Create Annotated Repertoire".
3. **Add tooltips or helper text**: Provide brief descriptions for annotation-related buttons on hover or long-press.
4. **Streamline UI**: Consider hiding advanced buttons by default or using a context menu to reduce clutter.
5. **Enhance feedback**: When a button is clicked but action fails (e.g., timeout), show an error message or loading state to inform the user.
6. **User guidance**: Include an onboarding tooltip or help icon that explains the annotation workflow for new users.

## Evidence

- Screenshots: 00-seeded.png (initial state), 01-moves-tab.png (Moves tab), 02-analysis-tab.png (Analysis tab), 03-after-generate.png (after clicking Generate).
- No faults were recorded (faults.json empty).
