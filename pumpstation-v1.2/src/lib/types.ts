import type { Settings, Severity, MotorState } from "./domain";

export type ShiftInfo = { key: string; label: string; role: string; members: string[]; auto: boolean };

export type MotorView = {
  tag: string;
  pumpTag: string;
  state: MotorState;
  stateFa: string;
  totalHours: number;
  lastServiceHours: number;
  hoursSinceService: number;
  servicePct: number;
  serviceInterval: number;
  avgCurrent: number | null;
  windingTemp: number | null;
  bearingTemp: number | null;
  maxVibration: number | null;
  severity: Severity;
  alerts: { param: string; label: string; message: string; severity: Severity }[];
  values: Record<string, number | null>;
  lastServiceDay: string;
  lastServiceWorkers: string;
  lastMeggerDay: string;
  lastOilDay: string;
};

export type ProcessView = {
  tag: string;
  label: string;
  unit: string;
  value: number | null;
  warnMin: number | null;
  warnMax: number | null;
  critMin: number | null;
  critMax: number | null;
  out: boolean;
};

export type IntervalView = { index: number; label: string; filled: number; total: number; current: boolean };

export type EquipmentView = {
  id: number;
  tag: string;
  name: string;
  category: string;
  spec: string;
  plate: string;
  partNumbers: string;
  location: string;
  status: string;
  statusFa: string;
  isAux: boolean;
  isMotor: boolean;
  safetyCritical: boolean;
  description: string;
  descriptionAt: string;
  descriptionBy: string;
  catalogs: { id: number; name: string; size: number; uploadedAt: string }[];
};

export type AlertView = {
  id: number;
  at: string;
  day: string;
  tag: string;
  param: string;
  label: string;
  value: number;
  severity: Severity;
  message: string;
  seenAt: string;
  actedAt: string;
  seenShift: string;
  actedShift: string;
  shiftKey: string;
};

export type ReportView = { id: number; kind: string; title: string; day: string; shiftKey: string; operators: string; createdAt: string };
export type ServiceLogView = { id: number; tag: string; kind: string; reason: string; operator: string; shiftKey: string; at: string };
export type ActivityView = { id: number; at: string; shiftKey: string; action: string; detail: string };
export type BackupView = { id: number; label: string; createdAt: string; sizeBytes: number };
export type ProblemView = { id: number; at: string; shiftKey: string; text: string };
export type MotorServiceView = {
  id: number;
  tag: string;
  day: string;
  hours: number;
  workers: string;
  note: string;
  brush: Record<string, number>;
  at: string;
  shiftKey: string;
  shiftLabel: string;
};
export type MeggerView = {
  id: number;
  tag: string;
  day: string;
  statorU: number | null;
  statorV: number | null;
  statorW: number | null;
  rotorU: number | null;
  rotorV: number | null;
  rotorW: number | null;
  windingTemp: number | null;
  pi: number | null;
  testVoltage: number;
  testVoltageRotor: number | null;
  piStatorU: number | null;
  piStatorV: number | null;
  piStatorW: number | null;
  piRotor: number | null;
  unit: string;
  workers: string;
  note: string;
  at: string;
  shiftKey: string;
};
export type OilView = { id: number; tag: string; day: string; hours: number; note: string; at: string; shiftKey: string };
export type PmTemplateView = { id: number; category: string; name: string; items: string[] };
export type PmRecordView = { id: number; tag: string; templateName: string; results: Record<string, string>; workers: string; note: string; day: string; at: string; shiftKey: string };
export type QueueView = { id: number; reportId: number; channelKey: string; status: string; attempts: number; lastError: string; createdAt: string; sentAt: string };
export type ChannelView = { key: string; provider: string; chatId: string; hasToken: boolean; enabled: boolean };

export type AppState = {
  me: { key: string; label: string; role: string; members: string[] };
  now: { day: string; weekday: string; monthLabel: string; time: string; intervalLabel: string; intervalIndex: number };
  shift: ShiftInfo;
  motors: MotorView[];
  process: ProcessView[];
  total: number | null;
  intervals: IntervalView[];
  equipment: EquipmentView[];
  alerts: AlertView[];
  serviceLogs: ServiceLogView[];
  activity: ActivityView[];
  reports: ReportView[];
  backups: BackupView[];
  problems: ProblemView[];
  note: string;
  settings: Settings;
  motorServices: MotorServiceView[];
  meggers: MeggerView[];
  oils: OilView[];
  pmTemplates: PmTemplateView[];
  pmRecords: PmRecordView[];
  queue: QueueView[];
  channels: ChannelView[];
  monthlyTotals: { day: string; value: number }[];
  roster: { key: string; label: string; members: string[]; role: string }[];
  counts: { equipment: number; readings: number; alerts: number; services: number };
  audits: { id: number; at: string; shiftKey: string; scope: string; tag: string; param: string; oldValue: string; newValue: string }[];
};
