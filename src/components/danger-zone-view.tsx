'use client';

import React, { useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from './ui/button';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { purgeData } from '@/app/actions';
import { Loader2, Trash2 } from 'lucide-react';

type PurgeableData = 'users' | 'shiftTemplates' | 'reportTemplates' | 'tasks' | 'mobileLoad' | 'leaveTypes' | 'groups' | 'shifts';

type DangerZoneViewProps = {
    onPurgeData: (dataType: PurgeableData) => void;
};

export default function DangerZoneView({ onPurgeData }: DangerZoneViewProps) {
    const { toast } = useToast();
    const [isPurging, startPurgeTransition] = useTransition();

    const handlePurge = (dataType: PurgeableData, friendlyName: string) => {
        startPurgeTransition(async () => {
            const result = await purgeData(dataType);
            if (result.success) {
                onPurgeData(dataType);
                toast({ title: 'Data Purged', description: `All ${friendlyName} have been deleted.` });
            } else {
                toast({ variant: 'destructive', title: 'Purge Failed', description: result.error || `Could not delete ${friendlyName}.` });
            }
        });
    };

    const purgeItems: { type: PurgeableData; title: string; description: string; buttonText: string; friendlyName: string }[] = [
        { type: 'shifts',          title: 'Clear All Schedule',          description: 'Permanently deletes all scheduled shifts for all employees across all dates. Shift templates are not affected.',                              buttonText: 'Clear Schedule',          friendlyName: 'scheduled shifts'  },
        { type: 'users',           title: 'Delete All Users',            description: 'Permanently deletes all users except the Super Admin, along with their associated shifts, leave, and tasks.',                                   buttonText: 'Delete Users',            friendlyName: 'users'             },
        { type: 'shiftTemplates',  title: 'Delete All Shift Templates',  description: 'Permanently deletes all saved shift templates.',                                                                                                  buttonText: 'Delete Shift Templates',  friendlyName: 'shift templates'   },
        { type: 'reportTemplates', title: 'Delete All Report Templates', description: 'Permanently deletes all uploaded Excel templates for reports.',                                                                                   buttonText: 'Delete Report Templates', friendlyName: 'report templates'  },
        { type: 'tasks',           title: 'Delete All Tasks',            description: 'Permanently deletes all personal, global, and shift-specific tasks.',                                                                             buttonText: 'Delete Tasks',            friendlyName: 'tasks'             },
        { type: 'mobileLoad',      title: 'Reset All Mobile Load Data',  description: "Deletes all historical mobile load balance records and resets every user's Load Allocation to zero.",                                            buttonText: 'Reset Mobile Load',       friendlyName: 'mobile load data'  },
        { type: 'leaveTypes',      title: 'Delete All Leave Types',      description: 'Permanently deletes all leave types.',                                                                                                            buttonText: 'Delete Leave Types',      friendlyName: 'leave types'       },
        { type: 'groups',          title: 'Delete All Groups',           description: 'Permanently deletes all groups and unassigns all users from their current group.',                                                                buttonText: 'Delete Groups',           friendlyName: 'groups'            },
    ];

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <Card className="border-destructive">
                <CardHeader>
                    <CardTitle className="text-destructive">Danger Zone</CardTitle>
                    <CardDescription>These actions are irreversible and affect the entire application. Proceed with extreme caution.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {purgeItems.map((item) => (
                        <React.Fragment key={item.type}>
                            <div className="flex items-center justify-between rounded-lg border border-destructive/50 p-4">
                                <div className="flex-1 mr-4">
                                    <h4 className="font-semibold">{item.title}</h4>
                                    <p className="text-sm text-muted-foreground">{item.description}</p>
                                </div>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" disabled={isPurging} className="w-48 shrink-0">
                                            {isPurging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                            {item.buttonText}
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                            <AlertDialogDescription>{item.description} This action cannot be undone.</AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handlePurge(item.type, item.friendlyName)}>Yes, delete them</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </React.Fragment>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
