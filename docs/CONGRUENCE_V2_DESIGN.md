# Congruence 2.0: Strategic Fit

## Product vision

Congruence 2.0 should answer one question:

> Where does this repertoire create avoidable strategic learning burden, and what is the safest way to reduce it?

Its optimization goal is:

> Minimize unnecessary strategic diversity while preserving objective soundness, opponent coverage, move-order resilience, and the user's intentional preferences.

It must never equate "different" with "bad." Every difference should be classified as one of:

- avoidable inconsistency;
- intentional diversity;
- productive diversity;
- opponent-forced diversity;
- uncertain or incomparable data.

The feature becomes a guided review process, not a scanner that produces warnings.

## 1. End-to-end workflow

### Step 1: Start analysis

The user clicks **Analyze strategic fit**.

A lightweight setup sheet appears on the first run:

#### What should this repertoire optimize for?

- **Familiar plans** — minimize unique structures and plans.
- **Balanced** — prefer familiarity without sacrificing strong practical choices.
- **Versatile** — preserve strategically diverse options.
- **Custom** — configure individual priorities.

The default is Balanced. The choice can be changed later without modifying the repertoire.

Optional advanced preferences include:

- maximum acceptable engine loss;
- importance of opponent popularity;
- importance of personal game frequency;
- tolerance for additional memorization;
- preferred structures and tactical character;
- structures the user intentionally avoids;
- minimum opponent coverage.

The user can skip setup. In that case, the system infers a provisional profile and labels it as inferred.

### Step 2: Preflight validation

Before strategic analysis, the system checks:

- illegal or malformed lines;
- duplicate branches;
- transpositions;
- shallow or incomplete lines;
- missing opening-classification data;
- stale training or game metadata;
- custom starting positions;
- repertoire color.

Blocking errors are shown separately from strategic findings.

Shallow lines are not silently compared with mature middlegame positions. They receive an "Incomplete evidence" state.

### Step 3: Progressive analysis

The analysis UI shows meaningful phases:

1. Normalizing move orders
2. Identifying comparable branches
3. Extracting strategic patterns
4. Measuring learning burden
5. Attributing differences to decisions
6. Ranking findings

The scan runs in a worker and supports cancellation. Findings may stream in, but they remain marked provisional until their cohort is complete.

Analysis depth is not shown here because the base analysis is engine-free. Engine depth appears only when alternatives are requested.

### Step 4: Strategic overview

The first result is not a list of problems. It is a repertoire health view:

- strategic profile;
- number of distinct strategic families;
- expected concept burden;
- forced-diversity floor;
- intentional exceptions;
- unresolved findings;
- branches with insufficient evidence;
- expected percentage of games covered by familiar plans.

Example:

> **Strategic workload: Moderate**  
> 74% of expected games reuse your three main strategic plans.  
> Four branches introduce additional plans; two appear avoidable, one is opponent-forced, and one lacks enough evidence.

The user can begin with the highest-priority finding or explore the strategic map.

### Step 5: Review findings individually

Findings enter a review queue. Every finding must end in one of these states:

- Change repertoire
- Keep intentionally
- Train as exception
- Reclassify cohort
- Exclude from analysis
- Defer
- Insufficient evidence
- Automatically resolved by another edit

The user can resolve findings in priority order, by opening, or in batch.

### Step 6: Inspect the evidence

Selecting a finding opens a comparison workspace showing:

- the affected branch;
- the cohort baseline;
- representative similar lines;
- exact strategic differences;
- the likely causal move;
- whether the user or opponent caused the divergence;
- expected frequency;
- training performance;
- confidence and data-quality warnings;
- optional engine soundness.

The user can move through synchronized boards at matched strategic checkpoints.

### Step 7: Choose a resolution

The user has four primary choices:

#### Find a more familiar line

Opens the Replacement Lab.

#### Keep this intentionally

Requires an optional reason:

- objectively strongest;
- surprise weapon;
- tournament-specific;
- strategically desirable;
- opponent-forced;
- already understood;
- custom note.

This becomes persistent repertoire metadata.

#### Train the exception

Creates a plan summary and training set without modifying the repertoire.

#### Adjust the analysis

The user can split the opening cohort, change the target profile, exclude the subtree, or mark the comparison as invalid.

### Step 8: Safely apply changes

A replacement is presented as a complete staged change set, not a single move.

The user sees:

- lines being added;
- lines being archived or pruned;
- coverage before and after;
- engine evaluation impact;
- strategic-workload impact;
- new transpositions;
- annotations being preserved;
- any newly uncovered opponent replies.

Nothing changes until explicit acceptance.

### Step 9: Verify the result

After acceptance, the affected cohort is rescanned automatically.

The UI reports:

> "Resolved: this branch now joins your main IQP family. Expected strategic workload decreased by 6%. Opponent coverage remains 96%."

If the edit creates another issue, the finding remains open and explains why.

### Step 10: Finish the review

The review is complete only when every finding is resolved, intentionally retained, deferred, or classified as uncertain.

The final summary records:

- edits made;
- exceptions retained;
- training items created;
- coverage change;
- objective-evaluation change;
- strategic-workload change;
- unresolved uncertainty.

## 2. UI design

### Primary layout

A desktop interface uses three coordinated panes:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Strategic Fit   Profile: Balanced   Coverage 96%   3 unresolved   │
├────────────────┬──────────────────────────┬────────────────────────┤
│ Strategic map  │ Findings                 │ Evidence / comparison  │
│                │                          │                        │
│ Opening groups │ Finding cards            │ Synchronized boards    │
│ Profile filter │ Priority filters         │ Concept differences    │
│ Heatmap toggle │ Resolution states        │ Decision attribution   │
└────────────────┴──────────────────────────┴────────────────────────┘
```

On mobile, these become:

1. Overview
2. Findings
3. Evidence
4. Resolution

### Finding card

Every finding card should contain enough information to understand it without opening a tooltip.

Example:

> **Different center plan**  
> Sicilian · Alapin, 6…Nf6 branch  
>  
> This branch produces a closed center, while 78% of comparable expected games produce an open IQP position. The difference becomes stable after your 8.e5.  
>  
> **12% expected frequency** · **Major difference** · **High confidence**  
> Likely user-controlled · Objectively sound  
>  
> `Review alternatives` `Keep intentionally` `Train`

Required fields:

- plain-language category;
- opening/system;
- affected line;
- one-sentence explanation;
- weighted baseline percentage;
- expected frequency;
- difference magnitude;
- confidence;
- causal-control indicator;
- soundness status, when verified;
- resolution state.

### Evidence panel

The expanded view includes:

#### Why it was found

A direct comparison:

| Dimension | Typical cohort | This branch |
|---|---|---|
| Center | Open/IQP | Closed |
| Primary break | d4–d5 | f2–f4 |
| King setup | Short castling | Long castling |
| Tactical level | Moderate | High |
| Unique concepts | 2 familiar | 5 new |

#### Comparison basis

- 14 effective branches
- 2,840 weighted reference games
- 91% structural-classification coverage
- analysis window: plies 10–24
- opening taxonomy version
- user profile: Balanced

#### Causal timeline

A line timeline marks:

- opponent divergence;
- candidate player decisions;
- first strategic difference;
- point at which it becomes stable;
- resulting transpositions.

#### Confidence explanation

Instead of showing only "82%," the UI says:

> High confidence: the difference persists across four checkpoints and is supported by 11 comparable branches. Opening classification is complete.

Expert users can expand the numerical components.

## 3. Strategic data model

### Repertoire graph

The repertoire is normalized into a transposition-aware decision graph rather than analyzed as independent PGN leaves.

Core entities:

#### Position

- canonical position key;
- legal state;
- side to move;
- opening taxonomy;
- incoming move orders;
- outgoing repertoire decisions.

#### Route

A path through the graph with:

- SAN and UCI moves;
- source PGN paths;
- expected frequency;
- personal game frequency;
- training metadata;
- strategic trajectory.

#### Strategic snapshot

A position-level observation containing:

- feature values;
- classifier confidence;
- provenance;
- analysis checkpoint;
- persistence state.

#### Strategic trajectory

An ordered series of snapshots across a route. It captures how a structure develops, rather than only where the author stopped writing.

#### Cohort

A set of comparable routes with:

- opening scope;
- decision scope;
- strategic modes;
- weighted baseline;
- effective sample size;
- user-defined overrides.

#### Finding

A revision-bound object containing:

- stable semantic ID;
- affected decisions and routes;
- category;
- evidence;
- causal attribution;
- difference;
- confidence;
- priority;
- resolution state;
- analysis-version provenance.

#### Resolution

A persistent record containing:

- user decision;
- rationale;
- relevant position and decision identities;
- expiry or invalidation rules;
- linked training material or staged edit.

Raw SAN paths are retained for navigation but are not the primary identity.

## 4. Strategic classification system

### Feature families

The analysis should separate concepts that are currently conflated.

#### Pawn topology

- IQP;
- hanging pawns;
- Carlsbad;
- Maroczy;
- Hedgehog;
- pawn chains;
- isolated, doubled, backward, connected, and passed pawns;
- wing majorities;
- pawn islands;
- static versus mobile weaknesses.

#### Center dynamics

- open;
- closed;
- fixed;
- fluid;
- tense;
- asymmetrical;
- likely central breaks;
- which side controls the break;
- persistence of the center state.

#### King and piece setup

- castling side;
- fianchetto history;
- bishop pair;
- good/bad bishop tendencies;
- knight outposts;
- recurring piece placements;
- common exchanges;
- queen retention or exchange.

#### Space and files

- space balance;
- open and half-open files;
- wing expansion;
- files used for pressure;
- minority attacks.

#### Dynamic character

Optional engine augmentation can measure:

- tactical volatility;
- evaluation sensitivity;
- forcing-move density;
- king-safety risk;
- acceptable material imbalance;
- sharpness;
- width of the viable-move set.

#### Learning concepts

A concept graph maps positions to:

- typical pawn breaks;
- plans;
- maneuvers;
- tactical motifs;
- favorable exchanges;
- common endgames.

This is the level that ultimately matters to the user.

### Diversity classifications

#### Genuine inconsistency

A high-confidence, persistent difference that:

- conflicts with the selected profile;
- is attributable substantially to a player decision;
- introduces meaningful additional learning;
- has at least one viable, more congruent alternative.

#### Forced diversity

The opponent creates the difference, or no acceptably sound and coverage-preserving alternative exists.

Primary recommendation: train the exception.

#### Intentional diversity

The user explicitly retains the difference, or it matches a declared repertoire objective.

It remains visible in the strategic map but leaves the unresolved queue.

#### Productive diversity

The branch adds strategic variety with a practical benefit:

- stronger evaluation;
- better coverage;
- surprise value;
- move-order robustness;
- reduced opponent preparation;
- better personal results.

The system should describe the tradeoff rather than encourage removal.

#### Mixed strategic profile

The cohort has multiple well-supported modes. There is no valid single majority baseline.

The user may retain the portfolio or choose a preferred mode.

#### Uncertain

Evidence is insufficient because of:

- short lines;
- low classifier confidence;
- small sample;
- unstable structures;
- missing opening data;
- conflicting signals.

No replacement recommendation is made.

#### Data-quality issue

Malformed, unsupported, or stale data prevented valid analysis.

#### Transpositional equivalence

Different move orders reach the same meaningful position. This is not strategic diversity and may instead suggest repertoire simplification.

## 5. Decision-making algorithm

### Phase A: Normalize the repertoire

1. Validate all moves.
2. Convert the tree into a transposition-aware graph.
3. Preserve all source paths.
4. Deduplicate identical strategic positions.
5. Identify editorial duplicates and incomplete lines.
6. Attach opening taxonomy at multiple levels rather than truncating a display name.

### Phase B: Build strategic trajectories

Analyze positions after the repertoire player's moves within configurable windows.

Default checkpoints include:

- exit from known opening classification;
- first central pawn resolution;
- first irreversible structural transformation;
- plies 12, 16, 20, and 24 where available;
- final valid repertoire position.

A feature becomes stable when it persists across at least two comparable player-turn checkpoints or is produced by an irreversible event.

Lines that do not reach comparable checkpoints are marked incomplete.

### Phase C: Weight routes

Default weight combines opening popularity and personal experience:

\[
W = \alpha P_{market} + \beta P_{personal} + \gamma P_{manual}
\]

The values are normalized inside each cohort.

Personal data uses shrinkage so five personal games do not overpower thousands of population games. Users can choose equal weighting.

Weights are normalized by opponent decision, preventing a deeply annotated branch from dominating because it contains more leaves.

The effective sample size is:

\[
N_{eff} = \frac{(\sum W_i)^2}{\sum W_i^2}
\]

This exposes cases where many nominal routes have little independent weight.

### Phase D: Form comparable cohorts

Cohorts use a hierarchy:

1. opening family;
2. opening system;
3. shared strategic ancestor;
4. canonical transpositions;
5. position-similarity neighborhood;
6. actionable player-decision scope.

Broad groups such as "Sicilian Defense" are descriptive containers, not automatic comparison cohorts.

The system detects multimodal cohorts. If two strategic modes both have meaningful weight, it preserves both rather than forcing one to become the outlier.

### Phase E: Build the target profile

The target profile comes from:

1. explicit user preferences;
2. intentional repertoire annotations;
3. weighted strategic modes;
4. personal training and game evidence;
5. inferred repertoire medoids.

Explicit intent always takes precedence over inferred majority.

For inference, use weighted medoids or mixture modes rather than a simple category count. Medoids preserve explainability because each baseline can be represented by real repertoire lines.

### Phase F: Measure strategic distance

Use an explainable mixed-feature distance.

For route \(r\) and cohort mode \(m\):

\[
D(r,m) = \sum_k w_k d_k(r,m)
\]

Where:

- \(w_k\) is the user- and model-defined importance of feature family \(k\);
- \(d_k\) is a normalized categorical, ordinal, numerical, or trajectory distance;
- matched checkpoints are compared instead of arbitrary endpoints.

The system records each feature's contribution, allowing explanations such as:

> "Most of the distance comes from center state (31%), castling pattern (24%), and unfamiliar pawn breaks (22%)."

A route is not an outlier merely because it differs. It must fall outside every supported strategic mode by a robust threshold such as weighted median distance plus a calibrated median-absolute-deviation margin.

### Phase G: Attribute causality

For each divergent route:

1. Walk backward from the first stable difference.
2. Identify irreversible events contributing to it.
3. Locate the earliest relevant player decision.
4. Separate effects of opponent and player moves.
5. Check transpositional alternatives.
6. On demand, search legal alternatives to determine whether the outcome was avoidable.

The result is a controllability score:

- 0–0.34: mostly opponent-forced;
- 0.35–0.64: shared or uncertain;
- 0.65–1.00: mostly player-controlled.

The UI presents this as language, not a raw decimal by default.

### Phase H: Detect strategic workload

A branch's learning burden considers:

- new concept count;
- overlap with mastered concepts;
- persistence;
- expected frequency;
- training retention;
- tactical sensitivity;
- amount of unique theory;
- distance from existing modes.

This avoids treating every structural difference as equally expensive.

## 6. Confidence, difference, and priority

These must be separate.

### Confidence

Confidence answers:

> "How likely is the analysis to have correctly identified and explained this difference?"

Components:

- classifier confidence;
- checkpoint completeness;
- effective sample size;
- temporal persistence;
- cohort coherence;
- opening-data quality;
- causal-attribution quality.

A weighted geometric calculation is appropriate because one critically weak component should limit the result.

Hard caps apply:

- effective sample below four: maximum 39, "Low";
- substantial incomplete-line share: maximum 49;
- unresolved classifier conflict: maximum 59;
- missing taxonomy with strong structural evidence: maximum 69.

Presentation:

- **High:** 75–100
- **Moderate:** 50–74
- **Low:** below 50

The expert panel exposes the exact components.

### Difference magnitude

Difference answers:

> "How strategically different is this branch?"

It combines:

- strategic distance;
- persistence;
- number of genuinely new concepts;
- depth at which the difference becomes stable.

Presentation:

- **Minor**
- **Moderate**
- **Major**

It must not be called severity because that suggests chess quality.

### Objective quality

Objective quality is separate and optional:

- engine evaluation;
- evaluation loss from best;
- depth;
- uncertainty across engine lines;
- database performance;
- theoretical status.

A strategically unusual line may be objectively excellent.

### Priority

Priority answers:

> "How valuable is it for this user to review this finding?"

A recommended formulation is:

\[
Priority = Confidence \times
(0.30D + 0.25F + 0.20L + 0.15U + 0.10A)
\]

Where:

- \(D\): difference magnitude;
- \(F\): expected frequency;
- \(L\): learning burden;
- \(U\): mismatch with user preferences;
- \(A\): actionability/controllability.

All components are normalized to 0–1.

Priority labels:

- **Review now**
- **Review later**
- **Informational**
- **Insufficient evidence**

Forced diversity can have high training priority but low replacement priority. The UI should show both when relevant.

## 7. Unique metrics

### Strategic entropy

Measures how dispersed expected games are across distinct strategic modes.

Lower is not always better. The user sees their selected target range.

### Concept reuse

The expected percentage of games that reuse already-mastered concepts.

Example:

> "Your three primary plan families apply to 81% of expected games."

### Exception burden

The expected frequency and training cost of branches outside primary modes.

### Forced-diversity floor

The minimum diversity the repertoire must retain without exceeding its evaluation and coverage constraints.

This prevents the product from promising impossible uniformity.

### Homogenization cost

The objective evaluation, popularity, or coverage sacrificed to make the repertoire more consistent.

Example:

> "Reducing this exception costs approximately 0.18 pawns and removes coverage of two common replies."

### Familiarity-adjusted coverage

Traditional coverage asks whether a reply exists. This metric asks whether covered positions belong to plans the user understands.

### Training-adjusted workload

A strategically different line is less problematic if the user consistently recalls it and performs well.

### Repertoire regret

Estimates whether the user is carrying unique theory that is rarely encountered, poorly remembered, and replaceable by a familiar alternative.

### Move-order resilience

Measures whether strategic modes survive opponent move-order changes and whether branches transpose into existing preparation.

### Concept centrality

Identifies concepts that transfer across the largest fraction of the repertoire, helping prioritize study.

## 8. Visualizations

### Strategic map

A two-dimensional map places strategically similar branches near one another.

- point size: expected frequency;
- color: opening family or strategic mode;
- border: resolution status;
- opacity: confidence;
- connecting lines: transpositions;
- selected finding: highlighted route.

The map must be explainable. It should display the top feature dimensions behind proximity and never rely solely on an opaque embedding.

### Concept heatmap

Rows are opening cohorts; columns are strategic concepts.

Cells show:

- expected frequency;
- mastery;
- confidence;
- whether the concept is intentional.

This reveals both redundancy and missing training.

### Strategic timeline

Two lines are compared across matched milestones:

```text
Opening setup → center resolves → king placement → pawn break → middlegame
Typical line:   tense center     O-O              c5 break
Outlier line:   locked center    O-O-O            f4 break
```

### Decision-flow diagram

A Sankey-like flow shows how opponent choices and player decisions distribute expected games into strategic modes.

This makes forced diversity visually obvious.

### Replacement Pareto chart

Candidates are plotted by:

- engine quality;
- strategic familiarity;
- memorization burden;
- opponent coverage.

No single "best" candidate is implied when tradeoffs differ.

### Before/after impact view

A staged edit previews changes to:

- coverage;
- strategic entropy;
- expected concept reuse;
- engine evaluation;
- theory size;
- training burden.

## 9. Leveraging existing metadata

### Opening popularity

Use explorer data to weight expected opponent choices and distinguish a frequent strategic exception from an obscure one.

Users can select:

- masters;
- broad online population;
- rating range;
- time control;
- recent years.

### Personal game history

Use:

- branch frequency;
- results;
- average centipawn loss;
- time usage;
- deviations from repertoire;
- recurring strategic errors.

Results should be treated as evidence, not proof of causation.

### Training performance

Use:

- recall rate;
- response time;
- lapse frequency;
- confidence ratings;
- spacing history.

A rare outlier with perfect recall can be deprioritized. A frequent, structurally familiar line with repeated lapses may need better training rather than replacement.

### User preferences

Preferences can be explicit or inferred:

- tactical versus positional;
- open versus closed centers;
- willingness to accept structural weaknesses;
- desired theory volume;
- risk tolerance;
- preferred endgames;
- comfort with opposite-side castling;
- acceptable evaluation loss.

Inferences must be visible, editable, and never silently treated as fact.

### PGN comments and annotations

Comments such as "must keep," "tournament weapon," or "avoid queenless middlegame" can become structured intent after user confirmation.

## 10. Replacement Lab

### Candidate generation

Candidates come from:

- existing repertoire transpositions;
- opening database alternatives;
- engine MultiPV;
- user-defined candidate moves;
- structurally similar positions elsewhere in the repertoire;
- known move-order shortcuts.

Candidates are first filtered for legality and objective viability.

### Candidate expansion

A replacement must be a coverage-aware subtree, not one engine PV.

For each candidate:

1. Analyze important opponent replies.
2. Include forcing replies even when uncommon.
3. Extend to a comparable strategic horizon.
4. Locate transpositions into existing preparation.
5. Calculate resulting strategic trajectory.
6. Estimate theory and training burden.

### Candidate presentation

Each candidate shows:

- complete proposed branches;
- repertoire-side evaluation;
- loss from engine best;
- expected opponent coverage;
- strategic-fit improvement;
- new concepts introduced;
- theory added and removed;
- popularity;
- transpositions;
- engine depth and confidence;
- unresolved tactical risks.

### Safe application

The staged change is revision-bound and atomic.

Possible operations:

- add full candidate subtree;
- link existing transpositions;
- preserve compatible comments;
- archive the old line;
- optionally prune the old line;
- create training items;
- update intent metadata.

Before acceptance, the system runs:

- legality validation;
- engine sanity check;
- coverage comparison;
- gap scan;
- transposition check;
- duplicate-line check;
- stale-revision check;
- affected-cohort congruence preview.

Pruning is never automatic. The default first action is to add and validate the alternative. The user then explicitly chooses whether to archive or remove the old branch.

Every accepted change supports undo and records its provenance.

## 11. AI-assisted capabilities

AI should explain and coordinate; deterministic chess tools remain the source of truth.

### Intent interview

The assistant can translate user goals into configuration:

> "I want a low-theory Black repertoire with similar kingside structures, but I'm willing to accept an IQP if it is clearly best."

It should show the resulting structured preferences for confirmation.

### Evidence-grounded explanations

AI can explain a finding at multiple levels:

- intermediate-player explanation;
- expert strategic breakdown;
- concise summary;
- training-focused explanation.

Every explanation must cite calculated signals and actual repertoire paths.

### Plan synthesis

For retained exceptions, AI can create:

- strategic plan cards;
- typical pawn-break explanations;
- favorable exchanges;
- danger signs;
- comparison with familiar structures;
- model-position drills.

### Repertoire redesign assistant

The user can request:

> "Reduce unique pawn structures by 20% without losing more than 0.15 and keep at least 95% popularity-weighted coverage."

The system can generate several safe, staged portfolio alternatives rather than editing automatically.

### Conflict detection

AI can identify contradictions among:

- declared preferences;
- existing repertoire choices;
- training behavior;
- requested replacement constraints.

It should ask for a decision rather than inventing one.

### Natural-language exploration

Examples:

- "Show only frequent avoidable exceptions."
- "Which branches force me into opposite-side castling?"
- "Where could I transpose into structures I already know?"
- "What should I train instead of replace?"
- "Why is this classified as intentional diversity?"

### AI safeguards

The language model must not independently:

- determine legality;
- invent engine evaluations;
- claim coverage;
- modify the repertoire;
- suppress uncertainty;
- convert inferred preferences into permanent intent.

## 12. Why the flagship feature becomes indispensable

Users would describe its value in terms like:

> "It tells me what my repertoire actually asks me to learn."

> "I can see the difference between a line that is unusual by choice and one the opponent forces on me."

> "It stopped me from replacing strong lines just because they looked different."

> "For every proposed change, I can see the cost in evaluation, coverage, and memory."

> "It finds transpositions that turn separate openings into one reusable plan."

> "When an exception cannot be removed, it teaches me exactly how to play it."

> "I can redesign an entire repertoire around my strengths without accidentally creating holes."

> "It turns a PGN collection into a coherent learning system."

The indispensable insight is not a consistency score. It is the connection among:

- repertoire construction;
- strategic understanding;
- objective chess quality;
- expected opponent behavior;
- personal performance;
- training workload.

No conventional opening-tree interface provides that complete loop.

## 13. Remaining unavoidable limitations

Even an ideal implementation cannot fully solve:

### Strategic meaning is contextual

Two superficially similar positions may demand different plans because of one piece placement. Two different structures may share transferable ideas. No finite taxonomy captures all chess understanding.

### Engines do not measure human practicality perfectly

Evaluation and MultiPV cannot reliably quantify:

- ease of play;
- memory pressure;
- psychological comfort;
- tournament suitability;
- surprise value.

### Causal attribution remains uncertain

A structure can emerge from several interacting decisions. Identifying one "causal move" is sometimes an explanatory convenience rather than objective truth.

### Sparse personal data

Many users will not have enough games or training history for reliable personalization.

### Popularity data is population-dependent

Moves common among masters may be rare at club level. Database selection changes conclusions.

### Opening theory changes

A safe replacement today may become theoretically problematic later. Analysis needs versioning and maintenance.

### User preferences evolve

A line marked intentional six months ago may no longer fit the user's goals.

### Generated replacement trees are incomplete

No finite repertoire can cover every legal or plausible reply. Coverage is always relative to thresholds and data sources.

### Compute cost

Deep multi-branch verification across a large repertoire is expensive, especially in-browser.

### AI explanations can oversimplify

Even grounded explanations may compress positional subtleties too aggressively. Expert inspection must remain available.

## 14. Hypothetical expert review

These are anticipated critiques based on three reviewer archetypes, not claims about their actual opinions.

### Magnus Carlsen's likely criticism

#### Critique

"You are reducing rich positions to labels. At elite level, one tempo, exchange, or move order matters more than whether both positions are called IQP. Strategic familiarity should never justify an inferior or predictable repertoire."

He would also challenge:

- broad claims about plans;
- static structure classifications;
- engine-depth sufficiency;
- the assumption that lower diversity is desirable;
- replacements that trade surprise value for superficial similarity.

#### Response

- Never treat taxonomy as the final model.
- Retain raw position and move-order distinctions.
- Make strategic similarity one axis, never the objective.
- Place hard evaluation and coverage constraints around optimization.
- Include novelty and predictability as benefits of productive diversity.
- Support multi-engine and deeper verification for expert mode.
- Expose every feature contribution and underlying line.
- Allow elite users to define concepts, cohorts, and exceptions manually.
- Default expert recommendations to "compare," never "replace."

The feature should help an elite player understand repertoire tradeoffs, not prescribe style.

### Levy Rozman's likely criticism

#### Critique

"This is powerful but overwhelming. Most players do not know what strategic entropy, effective sample size, or a hanging-pawn trajectory means. They will either ignore it or make bad changes based on a red badge."

He would likely emphasize:

- accessibility;
- teaching value;
- emotional framing;
- actionable next steps;
- avoiding analysis paralysis.

#### Response

Use progressive disclosure.

The default experience shows:

- one finding at a time;
- plain-language explanation;
- two synchronized boards;
- "why it matters";
- "change it" versus "learn it";
- one recommended next action.

Advanced metrics stay collapsed.

Every technical finding should translate into a lesson:

> "Most of your French lines attack with a closed center. This line opens the center early, so your usual kingside plan no longer applies."

Provide visual arrows, highlighted pawn breaks, and short plan cards. Avoid punitive colors and words such as "wrong" unless objective analysis supports them.

### ChessBase software architect's likely criticism

#### Critique

"This depends on unstable classifications, expensive graph analysis, external popularity data, engine versions, user metadata, and AI output. How are results reproduced, migrated, cached, exchanged, and trusted across millions of positions?"

They would also question:

- PGN interoperability;
- stable identities through edits;
- classifier versioning;
- transposition handling;
- incremental computation;
- deterministic versus AI-generated output;
- long-running job recovery.

#### Response

The architecture must include:

- a canonical transposition-aware repertoire graph;
- semantic decision IDs;
- revision-bound findings and edits;
- versioned taxonomy and classifier manifests;
- deterministic core analysis;
- explicit provenance for every metric;
- cache keys including repertoire revision, model version, and settings;
- incremental recomputation;
- worker/server execution for large collections;
- resumable jobs;
- sidecar metadata with PGN-compatible annotations for export;
- formal migrations for persisted resolutions;
- reproducible engine configuration;
- AI confined to explanation and orchestration.

A result should be inspectable as:

> "Generated from repertoire revision 81, taxonomy 2.3, structural model 4.1, explorer snapshot 2026-07, Stockfish 18 depth 24."

That level of provenance is necessary for the feature to earn expert trust.
