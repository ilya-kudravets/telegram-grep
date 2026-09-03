# localization Specification

## Purpose
One dictionary for every interface, so the TUI, the CLI, the self-hosted app and the static client say the same thing in the same language.

## Requirements

### Requirement: One dictionary, English as the base

All user-facing strings MUST come from a shared dictionary in the portable layer. English MUST be complete; other languages MAY be partial and MUST fall back to English per key. A missing key MUST degrade to the key itself rather than crashing.

#### Scenario: An untranslated string
- **WHEN** a locale lacks a key that English has
- **THEN** the English text is shown

#### Scenario: A new string is added
- **WHEN** a feature adds a user-facing string
- **THEN** it is added to the shared dictionary, not inlined in one interface

### Requirement: Placeholders are positional

Strings MUST interpolate positional placeholders, so word order can differ between languages without changing call sites.

#### Scenario: A count inside a sentence
- **WHEN** a string needs a number and a name
- **THEN** each locale places them where its grammar requires

### Requirement: Language selection

The language MUST follow an explicit choice when one exists, then the environment's language, then English. In the browser the choice MUST persist across reloads; on the command line an environment variable MUST override the system locale.

#### Scenario: Forcing a language in the terminal
- **WHEN** the language environment variable is set for a run
- **THEN** that language is used regardless of the system locale

#### Scenario: Choosing a language in the browser
- **WHEN** the user picks a language in the interface
- **THEN** it is remembered for later visits, and choosing "system" returns to following the browser

#### Scenario: Screens shown before the user is logged in
- **WHEN** a stored language choice exists and a pre-login screen is shown
- **THEN** it uses the stored choice rather than the browser's language, so no screen is left speaking a language the user has already overridden
