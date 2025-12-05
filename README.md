# new-wjx

new-wjx is a lightweight userscript/toolset for interacting with wjx.cn (WenJuanXing) forms and workflows. It continues and reorganizes ideas from the author's earlier repository while providing clearer documentation, installation steps, and development notes.

**Why this project**
- Many form workflows on `wjx.cn` can be automated or improved via a userscript to speed up repetitive tasks and improve reliability. This repository collects the scripts, helpers, and documentation to do that safely and maintainably.

**Features**
- Fill or pre-populate common fields.
- Skip or bypass non-essential prompts where allowed.
- Utility functions to extract or submit data programmatically.
- Small CLI/automation helpers for local testing and deployments (if included).

**Quick Links**
- Source: this repository
- Original inspiration: the author's `fuck-wjx` repository

**Table of Contents**
- **Installation**
- **Usage**
- **Configuration**
- **Development**
- **Contributing**
- **License**

**Installation**

- Userscript (recommended):
	- Install a userscript manager such as Tampermonkey (Chrome/Edge) or Violentmonkey/Greasemonkey (Firefox).
	- Install the userscript file(s) from this repository (for example, `new-wjx.user.js`) by opening them in the browser or using the manager's "Install from URL" feature.

- Standalone helpers / CLI: If the repository contains helper scripts, run them locally as described in their own README sections. There may be a `push.bat` or small scripts for Windows automation — review and run them at your own discretion.

**Usage**

- After installing the userscript, open a `wjx.cn` form page. The script will run automatically and show a lightweight UI or perform configured actions.
- For manual helpers, run the provided scripts following their usage instructions.

**Configuration**

- Edit script constants at the top of the userscript to set defaults (for example, automatic answers or field values).
- Sensitive or personal values should never be committed to the repository. Use local configuration or environment variables for secrets.

**Development**

- Requirements: a modern browser and a userscript manager for runtime testing. For editing, any code editor is fine.
- Recommended workflow:
	1. Edit the userscript file(s).
	2. Load the script into the userscript manager (or use auto-update URL during development).
	3. Test on `wjx.cn` pages and iterate.

**Contributing**

- Bug reports and pull requests are welcome. Keep changes focused and include tests or reproduction steps when possible.
- Follow standard GitHub contribution practices: create a branch, push, and open a PR describing your changes.

**License**

- This repository does not include a license file by default. If you want to open-source it, add a `LICENSE` (for example, MIT) and document it here.

**Acknowledgements**

- Inspiration and original work by the repository owner (see the `fuck-wjx` project for prior ideas).

---
