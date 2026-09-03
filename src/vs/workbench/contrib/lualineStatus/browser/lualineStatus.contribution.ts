/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isNative } from '../../../../base/common/platform.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { LualineStatus } from './lualineStatus.js';

// The fork's cosmetics are macOS native only (D14), and none of the entries this composes are
// worth holding up startup for: they all need the status bar to exist first.
if (isMacintosh && isNative) {
	registerWorkbenchContribution2(LualineStatus.ID, LualineStatus, WorkbenchPhase.AfterRestored);
}
