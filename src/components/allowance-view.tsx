

'use client';

import React, { useState, useMemo, useEffect, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import type { Employee, CommunicationAllowance, SmtpSettings } from '@/types';
import { format, subMonths, addMonths, isSameMonth, getDate, isFuture, startOfMonth, isToday, isAfter, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, Settings, Pencil, FileText, ArrowUpDown, CheckCircle, XCircle, Upload, Send, Loader2, Trash2 } from 'lucide-react';
import { cn, getInitialState } from '@/lib/utils';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DatePicker } from './ui/date-picker';
import { Separator } from './ui/separator';
import { AllowanceImporter, type ImportedAllowance } from './allowance-importer';
import { sendEmail, saveAllowanceScreenshot } from '@/app/actions';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';
import { Textarea } from './ui/textarea';


const Dashboard = ({ membersInGroup, allowances, currentDate, loadLimitPercentage, currency }: { membersInGroup: Employee[], allowances: CommunicationAllowance[], currentDate: Date, loadLimitPercentage: number, currency: string }) => {
    const currentYear = currentDate.getFullYear();
    const lastYear = currentYear - 1;

    const yearlyData = useMemo(() => {
        return membersInGroup.map(employee => {
            const processYear = (year: number) => {
                const yearAllowances = allowances.filter(a => a.employeeId === employee.id && a.year === year);
                
                let totalLoaded = 0;
                let monthsLoaded = 0;

                yearAllowances.forEach(allowance => {
                    const allocation = employee.loadAllocation || 0;
                    const limit = allocation * (loadLimitPercentage / 100);
                    const willReceive = (allowance.balance !== undefined && allowance.balance !== null) ? allowance.balance <= limit : undefined;

                    if (willReceive) {
                        totalLoaded += (employee.loadAllocation || 0);
                        monthsLoaded++;
                    }
                });
                return { totalLoaded, monthsLoaded };
            };

            const { totalLoaded: totalLoadedCurrentYear, monthsLoaded: monthsLoadedCurrentYear } = processYear(currentYear);
            const { totalLoaded: totalLoadedLastYear, monthsLoaded: monthsLoadedLastYear } = processYear(lastYear);

            return {
                employeeId: employee.id,
                name: `${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase(),
                totalLoadedCurrentYear,
                monthsLoadedCurrentYear,
                totalLoadedLastYear,
                monthsLoadedLastYear,
            };
        });
    }, [membersInGroup, allowances, currentYear, lastYear, loadLimitPercentage]);
    
    const totals = useMemo(() => {
        return yearlyData.reduce((acc, data) => {
            acc.currentYear += data.totalLoadedCurrentYear;
            acc.lastYear += data.totalLoadedLastYear;
            return acc;
        }, { currentYear: 0, lastYear: 0 });
    }, [yearlyData]);


    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Yearly Report</CardTitle>
                    <CardDescription>Individual load totals for the current and previous year, including only months where load was received.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Recipient</TableHead>
                                <TableHead>Total Loaded ({lastYear})</TableHead>
                                <TableHead>Months Loaded ({lastYear})</TableHead>
                                <TableHead>Total Loaded ({currentYear})</TableHead>
                                <TableHead>Months Loaded ({currentYear})</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {yearlyData.map(data => (
                                <TableRow key={data.employeeId}>
                                    <TableCell className="font-medium">{data.name}</TableCell>
                                    <TableCell>{currency}{data.totalLoadedLastYear.toFixed(2)}</TableCell>
                                    <TableCell>{data.monthsLoadedLastYear}</TableCell>
                                    <TableCell>{currency}{data.totalLoadedCurrentYear.toFixed(2)}</TableCell>
                                    <TableCell>{data.monthsLoadedCurrentYear}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Grand Totals</CardTitle>
                    <CardDescription>Sum of all loads disbursed in the last and current years.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Year</TableHead>
                                <TableHead className="text-right">Total Disbursed</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            <TableRow>
                                <TableCell>{lastYear}</TableCell>
                                <TableCell className="text-right font-semibold">{currency}{totals.lastYear.toFixed(2)}</TableCell>
                            </TableRow>
                             <TableRow>
                                <TableCell>{currentYear}</TableCell>
                                <TableCell className="text-right font-semibold">{currency}{totals.currentYear.toFixed(2)}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}

type AllowanceViewProps = {
  employees: Employee[];
  setEmployees: React.Dispatch<React.SetStateAction<Employee[]>>;
  allowances: CommunicationAllowance[];
  setAllowances: React.Dispatch<React.SetStateAction<CommunicationAllowance[]>>;
  currentUser: Employee | null;
  smtpSettings: SmtpSettings;
};

type SortConfig = {
    key: keyof Employee | 'balance' | 'excess';
    direction: 'asc' | 'desc';
}

export default function AllowanceView({ employees, setEmployees, allowances, setAllowances, currentUser, smtpSettings }: AllowanceViewProps) {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(() => addMonths(new Date(), 1));
  const [loadLimitPercentage, setLoadLimitPercentage] = useState<number>(() => getInitialState('globalLoadLimit', 150));
  const [editableStartDay, setEditableStartDay] = useState<number>(() => getInitialState('editableStartDay', 15));
  const [editableEndDay, setEditableEndDay] = useState<number>(() => getInitialState('editableEndDay', 20));
  const [currency, setCurrency] = useState<string>(() => getInitialState('globalCurrency', '₱'));
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isBalanceEditorOpen, setIsBalanceEditorOpen] = useState(false);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [editingAllowance, setEditingAllowance] = useState<Partial<CommunicationAllowance> | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'lastName', direction: 'asc' });
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  if (!currentUser) {
    return null;
  }
  
  const isManager = currentUser.role === 'manager' || currentUser.role === 'admin';
  
  const getEmployeeAllowance = (employeeId: string, date: Date): CommunicationAllowance | undefined => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return allowances.find(a => a.employeeId === employeeId && a.year === year && a.month === month);
  }

  const membersInGroup = React.useMemo(() => {
    let allMembersInGroup = employees.filter(e => e.group === currentUser.group && e.visibility?.mobileLoad !== false);

    allMembersInGroup.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        if (sortConfig.key === 'balance' || sortConfig.key === 'excess') {
            const aAllowance = getEmployeeAllowance(a.id, currentDate);
            const bAllowance = getEmployeeAllowance(b.id, currentDate);
            
            if (sortConfig.key === 'balance') {
                aValue = aAllowance?.balance ?? -1;
                bValue = bAllowance?.balance ?? -1;
            } else { // excess
                const aExcess = aAllowance?.balance !== undefined && aAllowance.balance !== null && aAllowance.balance > (a.loadAllocation || 0) ? aAllowance.balance - (a.loadAllocation || 0) : 0;
                const bExcess = bAllowance?.balance !== undefined && bAllowance.balance !== null && bAllowance.balance > (b.loadAllocation || 0) ? bAllowance.balance - (b.loadAllocation || 0) : 0;
                aValue = aExcess;
                bValue = bExcess;
            }

        } else {
             aValue = a[sortConfig.key as keyof Employee];
             bValue = b[sortConfig.key as keyof Employee];
        }


        if (aValue < bValue) {
            return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
            return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });

    if (isManager) {
        return allMembersInGroup;
    }
    return allMembersInGroup.filter(employee => {
        if (employee.id === currentUser.id) return true;
        const allowance = getEmployeeAllowance(employee.id, currentDate);
        return allowance && allowance.balance !== undefined && allowance.balance !== null;
    });
  }, [employees, currentUser, isManager, allowances, currentDate, sortConfig]);
  
  const monthlyStatus = useMemo(() => {
    let willReceiveCount = 0;
    let willNotReceiveCount = 0;

    membersInGroup.forEach(employee => {
        const allocation = employee.loadAllocation || 0;
        const allowance = getEmployeeAllowance(employee.id, currentDate);
        const balance = allowance?.balance;
        const limit = allocation * (loadLimitPercentage / 100);
        
        const willReceive = (balance !== undefined && balance !== null) ? balance <= limit : undefined;
        
        if (willReceive === true) {
            willReceiveCount++;
        } else if (willReceive === false) {
            willNotReceiveCount++;
        }
    });

    return { willReceiveCount, willNotReceiveCount };
  }, [membersInGroup, allowances, currentDate, loadLimitPercentage]);


  const handleOpenBalanceEditor = (employeeId: string, date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const existingAllowance = getEmployeeAllowance(employeeId, date);
    setEditingAllowance(existingAllowance || { employeeId, year, month });
    setIsBalanceEditorOpen(true);
  }

  const handleSaveBalance = () => {
    if (!editingAllowance) return;
    
    let savedId = editingAllowance.id;
    setAllowances(prev => {
        const existingIndex = prev.findIndex(a => a.id === editingAllowance.id || (a.employeeId === editingAllowance.employeeId && a.year === editingAllowance.year && a.month === editingAllowance.month));
        if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = { ...updated[existingIndex], ...editingAllowance } as CommunicationAllowance;
            savedId = updated[existingIndex].id;
            return updated;
        } else {
            const newAllowance: CommunicationAllowance = {
                id: `ca-${editingAllowance.employeeId}-${editingAllowance.year}-${editingAllowance.month}`,
                balance: 0,
                ...editingAllowance,
            } as CommunicationAllowance;
            savedId = newAllowance.id;
            return [...prev, newAllowance];
        }
    });
    // Save screenshot directly to DB — bypasses payload size limit
    if (editingAllowance.screenshot && savedId) {
        saveAllowanceScreenshot(savedId, editingAllowance.screenshot).catch(() => {});
    }
    toast({ title: 'Balance Updated'});
    setIsBalanceEditorOpen(false);
    setEditingAllowance(null);
  };
  
  const handleImport = (importedData: ImportedAllowance[]) => {
    // 1. Update employee allocations
    setEmployees(prevEmployees => {
      return prevEmployees.map(emp => {
        const importedEmp = importedData.find(d => d.employeeId === emp.id);
        if (importedEmp) {
          return { ...emp, loadAllocation: importedEmp.loadAllocation };
        }
        return emp;
      });
    });

    // 2. Update allowances for the current month
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    setAllowances(prevAllowances => {
      const updatedAllowances = [...prevAllowances];
      importedData.forEach(item => {
        const existingIndex = updatedAllowances.findIndex(a => 
          a.employeeId === item.employeeId && a.year === year && a.month === month
        );
        
        const newEntry: CommunicationAllowance = {
          id: `ca-${item.employeeId}-${year}-${month}`,
          employeeId: item.employeeId,
          year,
          month,
          balance: item.balance,
          asOfDate: item.asOfDate || new Date(),
        };

        if (existingIndex > -1) {
          updatedAllowances[existingIndex] = { ...updatedAllowances[existingIndex], ...newEntry };
        } else {
          updatedAllowances.push(newEntry);
        }
      });
      return updatedAllowances;
    });
    
    toast({ title: "Import Successful", description: `${importedData.length} records have been updated.` });
  };


  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => direction === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1));
  };
  
  const handleLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value)) {
          setLoadLimitPercentage(value);
      }
  }
  
  const handleStartDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value >= 1 && value <= 31) {
          setEditableStartDay(value);
      }
  }

  const handleEndDayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value >= 1 && value <= 31) {
          setEditableEndDay(value);
      }
  }
  
  const requestSort = (key: SortConfig['key']) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };


  const handleSaveSettings = () => {
      if (typeof window !== 'undefined') {
          localStorage.setItem('globalLoadLimit', JSON.stringify(loadLimitPercentage));
          localStorage.setItem('editableStartDay', JSON.stringify(editableStartDay));
          localStorage.setItem('editableEndDay', JSON.stringify(editableEndDay));
          localStorage.setItem('globalCurrency', currency);
      }
      toast({ title: "Global settings updated." });
      setIsSettingsOpen(false);
  }

  const generateExcelData = async (): Promise<Buffer | null> => {
    try {
        const today = new Date();
        const balanceHeader = `Load Balance as of ${format(today, 'MMMM d')}`;

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Report");

        // Define Header Styles
        const headerStyle: Partial<ExcelJS.Style> = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            }
        };

        const balanceHeaderStyle: Partial<ExcelJS.Style> = { ...headerStyle, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }, font: { bold: true, color: { argb: 'FF000000' } } };

        worksheet.columns = [
            { header: 'Recipient', key: 'recipient', width: 40 },
            { header: 'Load Allocation', key: 'allocation', width: 20 },
            { header: balanceHeader, key: 'balance', width: 30 }
        ];
        
        const headerRow = worksheet.getRow(1);
        headerRow.getCell('recipient').style = headerStyle;
        headerRow.getCell('allocation').style = headerStyle;
        headerRow.getCell('balance').style = balanceHeaderStyle;

        // Add Data
        membersInGroup.forEach(employee => {
            const allocation = employee.loadAllocation || 0;
            const allowance = getEmployeeAllowance(employee.id, currentDate);
            const balance = allowance?.balance;

            worksheet.addRow({
                recipient: `${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase(),
                allocation: `${currency}${allocation.toFixed(2)}`,
                balance: balance !== undefined && balance !== null ? `${currency}${balance.toFixed(2)}` : 'N/A'
            });
        });

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(arrayBuffer);
    } catch (error) {
        console.error("Error generating Excel report:", error);
        toast({
            title: 'Report Generation Failed',
            description: (error as Error).message,
            variant: 'destructive',
        });
        return null;
    }
  };

  const handleDownloadReport = async () => {
    const buffer = await generateExcelData();
    if (!buffer) return;

    const groupName = currentUser?.group || 'Team';
    const fileName = `${groupName} Communication Allowance - ${format(currentDate, 'MMMM yyyy')}.xlsx`;
    
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, fileName);

    toast({ title: 'Report Downloaded', description: 'The allowance report has been saved as an Excel file.' });
  };
  
  const SortableHeader = ({ tKey, children }: {tKey: SortConfig['key'], children: React.ReactNode}) => {
    const isSorted = sortConfig.key === tKey;
    const isAsc = sortConfig.direction === 'asc';
    return (
        <TableHead>
            <Button variant="ghost" onClick={() => requestSort(tKey)}>
                {children}
                <ArrowUpDown className={cn("ml-2 h-4 w-4", !isSorted && "opacity-20", isSorted && isAsc && "transform rotate-180")}/>
            </Button>
        </TableHead>
    )
  }

  const isNextMonthButtonDisabled = () => {
    if (isManager) return false; // Managers can always navigate
    
    const nextMonth = startOfMonth(addMonths(currentDate, 1));
    const oneMonthFromNow = startOfMonth(addMonths(new Date(), 1));

    // Disable if the next month to be viewed is beyond one month from the real current date.
    return isAfter(nextMonth, oneMonthFromNow);
  };
  
  const handleClearBalances = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    setAllowances(prev => prev.filter(a => !(a.year === year && a.month === month)));

    toast({
        title: 'Balances Cleared',
        description: `All allowance records for ${format(currentDate, 'MMMM yyyy')} have been deleted.`,
    });
  };

  const isMemberEditingAllowed = useMemo(() => {
    if (isManager) return false;
    const today = new Date();
    const isViewingNextMonth = isSameMonth(startOfMonth(currentDate), startOfMonth(addMonths(today, 1)));
    const isEditingWindowActive = getDate(today) >= editableStartDay && getDate(today) <= editableEndDay;
    return isEditingWindowActive && isViewingNextMonth;
  }, [isManager, currentDate, editableStartDay, editableEndDay]);


  return (
    <>
      <div className="space-y-4">
          <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">Communication Allowance</h2>
              <p className="text-muted-foreground">Monitor monthly communication allowances for your team.</p>
          </div>
          <Card>
              <CardHeader>
                  <CardTitle>Monthly Status</CardTitle>
                  <CardDescription>Overview for {format(currentDate, 'MMMM yyyy')}.</CardDescription>
              </CardHeader>
              <CardContent>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
                          <CheckCircle className="h-5 w-5 text-green-500" />
                          <p className="text-sm text-muted-foreground flex-1">Will Receive Load</p>
                          <p className="text-lg font-bold">{monthlyStatus.willReceiveCount}</p>
                      </div>
                      <div className="flex items-center gap-3 p-3 border rounded-lg">
                          <XCircle className="h-5 w-5 text-red-500" />
                          <p className="text-sm text-muted-foreground flex-1">Will Not Receive</p>
                          <p className="text-lg font-bold">{monthlyStatus.willNotReceiveCount}</p>
                      </div>
                  </div>
              </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Allowance Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                  <div className="flex flex-wrap gap-4 justify-between items-center">
                      <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" onClick={() => navigateMonth('prev')}>
                          <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <h2 className="text-xl font-bold text-center">
                              {format(currentDate, 'MMMM yyyy')}
                          </h2>
                          <Button variant="ghost" size="icon" onClick={() => navigateMonth('next')} disabled={isNextMonthButtonDisabled()}>
                          <ChevronRight className="h-4 w-4" />
                          </Button>
                          {isMemberEditingAllowed && (
                            <Button variant="outline" onClick={() => handleOpenBalanceEditor(currentUser.id, currentDate)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Update
                            </Button>
                          )}
                      </div>
                      {isManager && (
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                              <Button variant="outline" onClick={() => setIsImporterOpen(true)}>
                                  <Upload className="h-4 w-4 mr-2" />
                                  Import Balances
                              </Button>
                              <Button variant="outline" onClick={() => setIsSummaryOpen(true)}>
                                  <FileText className="h-4 w-4 mr-2" />
                                  Show Summary
                              </Button>
                              <Button variant="outline" onClick={() => setIsEmailDialogOpen(true)}>
                                  <Send className="h-4 w-4 mr-2" />
                                  Send Email
                              </Button>
                              <Button variant="outline" onClick={handleDownloadReport}>
                                  <Download className="h-4 w-4 mr-2" />
                                  Download Report
                              </Button>
                              <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                      <Button variant="destructive" size="icon">
                                          <Trash2 className="h-4 w-4" />
                                      </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                      <AlertDialogHeader>
                                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                          This action will permanently delete all balance records for {format(currentDate, 'MMMM yyyy')}. This cannot be undone.
                                      </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={handleClearBalances}>Continue</AlertDialogAction>
                                      </AlertDialogFooter>
                                  </AlertDialogContent>
                              </AlertDialog>
                              <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                                  <DialogTrigger asChild>
                                      <Button variant="outline" size="icon">
                                          <Settings className="h-4 w-4" />
                                      </Button>
                                  </DialogTrigger>
                                  <DialogContent className="sm:max-w-[425px]">
                                      <DialogHeader>
                                      <DialogTitle>Global Settings</DialogTitle>
                                      <DialogDescription>
                                          Set the global load limit, member editing window, and currency.
                                      </DialogDescription>
                                      </DialogHeader>
                                      <div className="grid gap-4 py-4">
                                          <div className="grid grid-cols-4 items-center gap-4">
                                              <Label htmlFor="loadLimit" className="text-right col-span-2">
                                              Global Load Limit (%)
                                              </Label>
                                              <Input
                                                  id="loadLimit"
                                                  type="number"
                                                  value={loadLimitPercentage}
                                                  onChange={handleLimitChange}
                                                  className="col-span-2"
                                              />
                                          </div>
                                          <div className="grid grid-cols-4 items-center gap-4">
                                              <Label className="text-right col-span-2">
                                                  Editing Window (Day)
                                              </Label>
                                              <div className="col-span-2 grid grid-cols-2 gap-2">
                                              <Input
                                                  id="startDay"
                                                  type="number"
                                                  min="1"
                                                  max="31"
                                                  placeholder="Start"
                                                  value={editableStartDay}
                                                  onChange={handleStartDayChange}
                                              />
                                              <Input
                                                  id="endDay"
                                                  type="number"
                                                  min="1"
                                                  max="31"
                                                  placeholder="End"
                                                  value={editableEndDay}
                                                  onChange={handleEndDayChange}
                                              />
                                              </div>
                                          </div>
                                          <div className="grid grid-cols-4 items-center gap-4">
                                              <Label htmlFor="currency" className="text-right col-span-2">
                                              Currency Symbol
                                              </Label>
                                              <Input
                                                  id="currency"
                                                  type="text"
                                                  value={currency}
                                                  onChange={(e) => setCurrency(e.target.value)}
                                                  className="col-span-2"
                                              />
                                          </div>
                                      </div>
                                      <DialogFooter>
                                          <Button onClick={handleSaveSettings}>Save changes</Button>
                                      </DialogFooter>
                                  </DialogContent>
                              </Dialog>
                          </div>
                      )}
                  </div>
                  <Table className="mt-4">
                  <TableHeader>
                      <TableRow>
                          <SortableHeader tKey="lastName">Recipient</SortableHeader>
                          <SortableHeader tKey="loadAllocation">Load Allocation</SortableHeader>
                          <SortableHeader tKey="balance">Load Balance</SortableHeader>
                          <TableHead>Balance as of</TableHead>
                          <TableHead>Limit ({loadLimitPercentage}%)</TableHead>
                          <SortableHeader tKey="excess">Excess in Allocation</SortableHeader>
                          <TableHead>Receives Load?</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {membersInGroup.map((employee) => {
                      const allocation = employee.loadAllocation || 0;
                      const allowance = getEmployeeAllowance(employee.id, currentDate);
                      const balance = allowance?.balance;
                      const limit = allocation * (loadLimitPercentage / 100);
                      const excess = balance !== undefined && balance !== null && balance > allocation ? balance - allocation : 0;
                      
                      const willReceive = (balance !== undefined && balance !== null) ? balance <= limit : undefined;
                      
                      return (
                          <TableRow key={employee.id}>
                          <TableCell className="font-medium">{`${employee.lastName}, ${employee.firstName} ${employee.middleInitial || ''}`.toUpperCase()}</TableCell>
                          <TableCell>{currency}{allocation.toFixed(2)}</TableCell>
                          <TableCell>
                              <span>{(balance !== undefined && balance !== null) ? `${currency}${balance.toFixed(2)}` : 'N/A'}</span>
                          </TableCell>
                          <TableCell>
                              {allowance?.asOfDate ? format(new Date(allowance.asOfDate), 'MMM d, yyyy') : 'N/A'}
                          </TableCell>
                          <TableCell>{currency}{limit.toFixed(2)}</TableCell>
                          <TableCell>{excess > 0 ? `${currency}${excess.toFixed(2)}` : ''}</TableCell>
                          <TableCell className={cn(willReceive === false && 'bg-red-200 text-black font-bold')}>
                              {willReceive === undefined ? 'N/A' : (willReceive ? 'Yes' : 'No')}
                          </TableCell>
                           <TableCell className="text-right">
                              {isManager && (
                                  <Button size="icon" variant="ghost" onClick={() => handleOpenBalanceEditor(employee.id, currentDate)}>
                                      <Pencil className="h-4 w-4" />
                                  </Button>
                              )}
                          </TableCell>
                          </TableRow>
                      );
                      })}
                  </TableBody>
                  </Table>
              </div>
            </CardContent>
          </Card>
      </div>
      
      {isClient && isEmailDialogOpen && (
          <EmailDialog
              isOpen={isEmailDialogOpen}
              setIsOpen={setIsEmailDialogOpen}
              smtpSettings={smtpSettings}
              generateExcelData={generateExcelData}
              fileName={`${currentUser.group} Communication Allowance - ${format(currentDate, 'MMMM yyyy')}.xlsx`}
          />
      )}

      <Dialog open={isBalanceEditorOpen} onOpenChange={setIsBalanceEditorOpen}>
          <DialogContent>
              <DialogHeader>
                  <DialogTitle>Update Load Balance</DialogTitle>
                  <DialogDescription>
                      Enter the details for your current load balance for {editingAllowance ? format(new Date(editingAllowance.year!, editingAllowance.month!), 'MMMM yyyy') : ''}.
                  </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                  <div className="space-y-2">
                      <Label htmlFor="balance">Load Balance</Label>
                      <Input 
                          id="balance"
                          type="number"
                          step="0.01"
                          value={editingAllowance?.balance ?? ''}
                          onChange={(e) => setEditingAllowance(prev => ({ ...prev, balance: parseFloat(e.target.value) }))}
                      />
                  </div>
                  <div className="space-y-2">
                      <Label>Load balance as of</Label>
                      <DatePicker 
                          date={editingAllowance?.asOfDate ? new Date(editingAllowance.asOfDate) : undefined}
                          onDateChange={(date) => setEditingAllowance(prev => ({...prev, asOfDate: date}))}
                      />
                  </div>
                  <div className="space-y-2">
                      <Label htmlFor="screenshot">Screenshot (optional)</Label>
                      <Input 
                          id="screenshot"
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                  const reader = new FileReader();
                                  reader.onloadend = () => {
                                      setEditingAllowance(prev => ({...prev, screenshot: reader.result as string}));
                                  };
                                  reader.readAsDataURL(file);
                              }
                          }}
                      />
                  </div>
              </div>
              <DialogFooter>
                  <Button variant="ghost" onClick={() => setIsBalanceEditorOpen(false)}>Cancel</Button>
                  <Button onClick={handleSaveBalance}>Save</Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>

      <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
          <DialogContent className="max-w-4xl">
              <DialogHeader>
                  <DialogTitle>Summary</DialogTitle>
                  <DialogDescription>
                      An overview of yearly reports and group allocations.
                  </DialogDescription>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto p-1">
                  <Dashboard membersInGroup={membersInGroup} allowances={allowances} currentDate={currentDate} loadLimitPercentage={loadLimitPercentage} currency={currency} />
              </div>
              <DialogFooter>
                  <Button onClick={() => setIsSummaryOpen(false)}>Close</Button>
              </DialogFooter>
          </DialogContent>
      </Dialog>
      
      <AllowanceImporter 
          isOpen={isImporterOpen}
          setIsOpen={setIsImporterOpen}
          onImport={handleImport}
          employees={employees}
      />
    </>
  );
}

type EmailDialogProps = {
    isOpen: boolean;
    setIsOpen: (isOpen: boolean) => void;
    smtpSettings: SmtpSettings;
    generateExcelData: () => Promise<Buffer | null>;
    fileName: string;
};

function EmailDialog({ 
    isOpen, 
    setIsOpen, 
    smtpSettings,
    generateExcelData,
    fileName,
}: EmailDialogProps) {
    const defaultSubject = `Communication Allowance Report - ${fileName.split(' - ')[1].replace('.xlsx', '')}`;
    const [to, setTo] = useState('');
    const [subject, setSubject] = useState(defaultSubject);
    const [body, setBody] = useState('Please find the report attached.');
    const [isSending, startTransition] = useTransition();
    const { toast } = useToast();

    useEffect(() => {
        if (isOpen) {
            setSubject(defaultSubject);
            setBody('Please find the report attached.');
            setTo('');
        }
    }, [isOpen, defaultSubject]);
    
    const handleSend = async () => {
        if (!to) {
            toast({ variant: 'destructive', title: 'Recipient required', description: 'Please enter an email address.' });
            return;
        }

        startTransition(async () => {
            try {
                toast({ title: 'Generating report...', description: 'Please wait while the file is being prepared.'});
                const excelBuffer = await generateExcelData();
                 if (!excelBuffer) {
                    toast({ variant: 'destructive', title: 'Cannot Send', description: 'The report could not be generated.' });
                    return;
                }

                const attachments = [{
                    filename: fileName,
                    content: excelBuffer.toString('base64'),
                }];
                
                toast({ title: 'Sending email...', description: `Sending report to ${to}.`});
                const result = await sendEmail({ to, subject, htmlBody: body.replace(/\n/g, '<br>'), attachments }, smtpSettings);

                if (result?.success) {
                    toast({ title: 'Email Sent', description: `Report sent to ${to}.` });
                    setIsOpen(false);
                } else {
                    toast({ variant: 'destructive', title: 'Email Failed', description: result?.error || 'An unknown error occurred.' });
                }
            } catch(e: any) {
                toast({ variant: 'destructive', title: 'Failed to generate report', description: e.message });
            }
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Send Report via Email</DialogTitle>
                    <DialogDescription>The report will be generated and sent as an Excel attachment.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="recipientEmail">Recipient Email</Label>
                        <Input id="recipientEmail" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" />
                    </div>
                     <div className="space-y-2">
                        <Label>Subject</Label>
                        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Body</Label>
                        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSend} disabled={isSending}>
                        {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
