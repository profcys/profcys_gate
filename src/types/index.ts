/** PROFCYS Gateway 공용 타입 (서버 API 응답 구조와 일치) */

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';
export type ServiceStatus = 'DRAFT' | 'ACTIVE' | 'SCHEDULED' | 'MAINTENANCE' | 'INACTIVE' | 'ARCHIVED';
export type EffectiveStatus = ServiceStatus | 'EXPIRED';
export type CardState = 'AVAILABLE' | 'LOCKED' | 'MAINTENANCE' | 'STOPPED';
export type OpenMode = 'NEW_TAB' | 'SAME_TAB' | 'EMBED' | 'SSO';
export type CardStyle = '' | 'default' | 'icon' | 'thumbnail' | 'list' | 'color';
export type LayoutMode = 'auto' | 'grid2' | 'grid3' | 'grid4' | 'list' | 'compact' | 'grouped';
export type CardSize = 'large' | 'default' | 'small' | 'compact';

export interface User {
  uid: string;
  username: string;
  displayName: string;
  organization: string;
  department: string;
  position: string;
  email: string;
  phone: string;
  role: Role;
  status: AccountStatus;
  groups: string[];
  allowedServices: string[];
  delegatedServices: string[];
  mustChangePassword: boolean;
  validFrom: string;
  validUntil: string;
  createdAt: number | null;
  createdBy: string;
  updatedAt: number | null;
  lastLoginAt: number | null;
  previousLoginAt: number | null;
  passwordChangedAt: number | null;
  memo?: string;
  lockedUntil?: number;
}

export interface SessionInfo {
  createdAt: number;
  expiresAt: number;
  idleTimeoutMin: number;
  lastActivityAt: number;
  warningMinutes: number;
}

export interface PlatformInfo {
  platformName: string;
  platformNameEn: string;
  supportContact: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  copyright: string;
  passwordMinLength: number;
}

export interface ServiceCard {
  serviceId: string;
  serviceName: string;
  englishName: string;
  icon: string;
  primaryColor: string;
  categoryId: string;
  sortOrder: number;
  isPinned: boolean;
  state: CardState;
  canLaunch: boolean;
  description?: string;
  detailedDescription?: string;
  keywords?: string[];
  serviceType?: string;
  backgroundColor?: string;
  thumbnailUrl?: string;
  cardStyle?: CardStyle;
  openMode?: OpenMode;
  maintenanceMessage?: string;
  isNew?: boolean;
  publishedAt?: number | null;
  favorite?: boolean;
  lastAccessAt?: number | null;
}

export interface Category {
  categoryId: string;
  categoryName: string;
  description?: string;
  icon: string;
  color: string;
  sortOrder: number;
  isActive?: boolean;
  serviceCount?: number;
}

export interface UiSettings {
  layoutMode: LayoutMode;
  desktopColumns: number;
  tabletColumns: number;
  mobileColumns: number;
  cardSize: CardSize;
  defaultCardStyle: Exclude<CardStyle, ''>;
  showWelcomeMessage: boolean;
  showServiceCount: boolean;
  showAvailableCount: boolean;
  showCategories: boolean;
  showSearch: boolean;
  showFavorites: boolean;
  showRecentServices: boolean;
  showNewServices: boolean;
  showAnnouncements: boolean;
  showServiceDescription: boolean;
  showServiceStatus: boolean;
  showLastAccess: boolean;
  showLaunchButton: boolean;
  defaultSortOrder: 'manual' | 'name' | 'recent';
  pageSize: number;
  version?: number;
  updatedAt?: number;
  updatedBy?: string;
}

export interface Announcement {
  announcementId: string;
  title: string;
  content: string;
  category: 'GENERAL' | 'IMPORTANT' | 'UPDATE' | 'MAINTENANCE' | 'GUIDE' | 'SECURITY';
  priority: 'NORMAL' | 'HIGH';
  targetRoles?: Role[];
  targetServices?: string[];
  isActive?: boolean;
  startDate?: string;
  endDate?: string;
  createdAt?: number;
  createdByName?: string;
}

export interface NotificationItem {
  type: 'ANNOUNCEMENT' | 'NEW_SERVICE';
  id: string;
  title: string;
  at: number;
  priority?: string;
  unread: boolean;
}

export interface DashboardData {
  user: User;
  services: ServiceCard[];
  categories: Category[];
  ui: UiSettings;
  announcements: Announcement[];
  notifications: NotificationItem[];
  prefs: { favoriteServices: string[]; recentServices: { serviceId: string; at: number }[]; theme: string; language: string };
  counts: { visible: number; available: number; maintenance: number; locked: number };
  platform: PlatformInfo;
  session: SessionInfo;
  rev: number;
  serverTime: number;
}

export interface AccessPolicy {
  mode: 'NONE' | 'ALL' | 'ADMINS' | 'RULES';
  roles: Role[];
  organizations: string[];
  groups: string[];
  denyUserIds: string[];
  applyToFutureMembers?: boolean;
}

/** 관리자용 전체 서비스 정보 */
export interface AdminService {
  serviceId: string;
  serviceName: string;
  englishName: string;
  description: string;
  detailedDescription: string;
  url: string;
  serviceType: string;
  categoryId: string;
  keywords: string[];
  icon: string;
  primaryColor: string;
  backgroundColor: string;
  thumbnailUrl: string;
  cardStyle: CardStyle;
  sortOrder: number;
  isPinned: boolean;
  status: ServiceStatus;
  effectiveStatus: EffectiveStatus;
  publishAt: number | null;
  expireAt: number | null;
  publishedAt: number | null;
  showNewBadge: boolean;
  newBadgeUntil: number | null;
  openMode: OpenMode;
  ssoTransport: 'POST' | 'QUERY';
  authenticationMode: string;
  integrationStatus: string;
  securityVerified: boolean;
  directAccess: 'UNVERIFIED' | 'BLOCKED' | 'OPEN';
  accessPolicy: AccessPolicy;
  maintenanceMessage: string;
  hideWhenInactive: boolean;
  assignedAdminIds: string[];
  isInitialService?: boolean;
  targetStatus?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  version: number;
  permittedUserCount: number | null;
  hasIntegrationKey?: boolean;
  lastSsoSuccessAt?: number | null;
}

export interface PlatformSettings {
  platformName: string;
  platformNameEn: string;
  platformLogo: string;
  sessionTimeout: number;
  sessionWarningMinutes: number;
  maximumSessionDuration: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  supportContact: string;
  timezone: string;
  defaultLanguage: string;
  showRestrictedServices: boolean;
  logRetentionDays: number;
  registrationEnabled: boolean;
  allowedServiceDomains: string[];
  passwordMinLength: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  ssoCodeTtlSeconds: number;
  newBadgeDays: number;
  portalUrl: string;
  copyright: string;
  version: number;
}

export interface LaunchResult {
  url: string;
  openMode: OpenMode;
  serviceName: string;
  sso?: { code: string; transport: 'POST' | 'QUERY'; param: string; expiresInSec: number };
}
