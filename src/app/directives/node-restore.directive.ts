/*!
 * @license
 * Alfresco Example Content Application
 *
 * Copyright (C) 2005 - 2018 Alfresco Software Limited
 *
 * This file is part of the Alfresco Example Content Application.
 * If the software was purchased under a paid Alfresco license, the terms of
 * the paid license agreement will prevail.  Otherwise, the software is
 * provided under the following open source license terms:
 *
 * The Alfresco Example Content Application is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * The Alfresco Example Content Application is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Alfresco. If not, see <http://www.gnu.org/licenses/>.
 */

import { Directive, HostListener, Input } from '@angular/core';
import { Observable } from 'rxjs/Rx';
import {
    MinimalNodeEntity,
    MinimalNodeEntryEntity,
    PathInfoEntity,
    DeletedNodesPaging
} from 'alfresco-js-api';
import { DeleteStatus, DeletedNodeInfo } from '../store/models';
import { ContentManagementService } from '../services/content-management.service';
import { Store } from '@ngrx/store';
import { AppStore } from '../store/states/app.state';
import {
    NavigateRouteAction,
    SnackbarAction,
    SnackbarErrorAction,
    SnackbarInfoAction,
    SnackbarUserAction
} from '../store/actions';
import { ContentApiService } from '../services/content-api.service';

@Directive({
    selector: '[acaRestoreNode]'
})
export class NodeRestoreDirective {
    // tslint:disable-next-line:no-input-rename
    @Input('acaRestoreNode') selection: MinimalNodeEntity[];

    @HostListener('click')
    onClick() {
        this.restore(this.selection);
    }

    constructor(
        private store: Store<AppStore>,
        private contentApi: ContentApiService,
        private contentManagementService: ContentManagementService
    ) {}

    private restore(selection: MinimalNodeEntity[] = []) {
        if (!selection.length) {
            return;
        }

        const nodesWithPath = selection.filter(node => node.entry.path);

        if (selection.length && !nodesWithPath.length) {
            const failedStatus = this.processStatus([]);
            failedStatus.fail.push(...selection);
            this.restoreNotification(failedStatus);
            this.refresh();
            return;
        }

        let status: DeleteStatus;

        Observable.forkJoin(nodesWithPath.map(node => this.restoreNode(node)))
            .do(restoredNodes => {
                status = this.processStatus(restoredNodes);
            })
            .flatMap(() => this.contentApi.getDeletedNodes())
            .subscribe((nodes: DeletedNodesPaging) => {
                const selectedNodes = this.diff(status.fail, selection, false);
                const remainingNodes = this.diff(
                    selectedNodes,
                    nodes.list.entries
                );

                if (!remainingNodes.length) {
                    this.restoreNotification(status);
                    this.refresh();
                } else {
                    this.restore(remainingNodes);
                }
            });
    }

    private restoreNode(node: MinimalNodeEntity): Observable<any> {
        const { entry } = node;

        return this.contentApi.restoreNode(entry.id)
            .map(() => ({
                status: 1,
                entry
            }))
            .catch(error => {
                const { statusCode } = JSON.parse(error.message).error;

                return Observable.of({
                    status: 0,
                    statusCode,
                    entry
                });
            });
    }

    private diff(selection, list, fromList = true): any {
        const ids = selection.map(item => item.entry.id);

        return list.filter(item => {
            if (fromList) {
                return ids.includes(item.entry.id) ? item : null;
            } else {
                return !ids.includes(item.entry.id) ? item : null;
            }
        });
    }

    private processStatus(data: DeletedNodeInfo[] = []): DeleteStatus {
        const status = {
            fail: [],
            success: [],
            get someFailed() {
                return !!this.fail.length;
            },
            get someSucceeded() {
                return !!this.success.length;
            },
            get oneFailed() {
                return this.fail.length === 1;
            },
            get oneSucceeded() {
                return this.success.length === 1;
            },
            get allSucceeded() {
                return this.someSucceeded && !this.someFailed;
            },
            get allFailed() {
                return this.someFailed && !this.someSucceeded;
            },
            reset() {
                this.fail = [];
                this.success = [];
            }
        };

        return data.reduce((acc, node) => {
            if (node.status) {
                acc.success.push(node);
            } else {
                acc.fail.push(node);
            }

            return acc;
        }, status);
    }

    private getRestoreMessage(status: DeleteStatus): SnackbarAction {
        if (status.someFailed && !status.oneFailed) {
            return new SnackbarErrorAction(
                'APP.MESSAGES.ERRORS.TRASH.NODES_RESTORE.PARTIAL_PLURAL',
                { number: status.fail.length }
            );
        }

        if (status.oneFailed && status.fail[0].statusCode) {
            if (status.fail[0].statusCode === 409) {
                return new SnackbarErrorAction(
                    'APP.MESSAGES.ERRORS.TRASH.NODES_RESTORE.NODE_EXISTS',
                    { name: status.fail[0].entry.name }
                );
            } else {
                return new SnackbarErrorAction(
                    'APP.MESSAGES.ERRORS.TRASH.NODES_RESTORE.GENERIC',
                    { name: status.fail[0].entry.name }
                );
            }
        }

        if (status.oneFailed && !status.fail[0].statusCode) {
            return new SnackbarErrorAction(
                'APP.MESSAGES.ERRORS.TRASH.NODES_RESTORE.LOCATION_MISSING',
                { name: status.fail[0].entry.name }
            );
        }

        if (status.allSucceeded && !status.oneSucceeded) {
            return new SnackbarInfoAction(
                'APP.MESSAGES.INFO.TRASH.NODES_RESTORE.PLURAL'
            );
        }

        if (status.allSucceeded && status.oneSucceeded) {
            return new SnackbarInfoAction(
                'APP.MESSAGES.INFO.TRASH.NODES_RESTORE.SINGULAR',
                { name: status.success[0].entry.name }
            );
        }

        return null;
    }

    restoreNotification(status: DeleteStatus): void {
        const message = this.getRestoreMessage(status);

        if (message) {
            if (status.oneSucceeded && !status.someFailed) {
                const isSite = this.isSite(status.success[0].entry);
                const path: PathInfoEntity = status.success[0].entry.path;
                const parent = path.elements[path.elements.length - 1];
                const route = isSite ? ['/libraries'] : ['/personal-files', parent.id];

                const navigate = new NavigateRouteAction(route);

                message.userAction = new SnackbarUserAction(
                    'APP.ACTIONS.VIEW',
                    navigate
                );
            }

            this.store.dispatch(message);
        }
    }

    private isSite(entry: MinimalNodeEntryEntity): boolean {
        return entry.nodeType === 'st:site';
    }

    private refresh(): void {
        this.contentManagementService.nodesRestored.next();
    }
}
