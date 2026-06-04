export type ContactId = number;
export type GroupId = number;

export interface Contact {
  id: ContactId;
  firstName: string;
  lastName: string;
  displayName: string;
  organization: string | null;
  jobTitle: string | null;
  department: string | null;
  birthday: Date | null;
  note: string | null;
  hasImage: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface ContactEmail {
  address: string;
  label: string | null;
  isPrimary: boolean;
}

export interface ContactPhone {
  number: string;
  label: string | null;
  isPrimary: boolean;
}

export interface ContactAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  label: string | null;
}

export interface ContactURL {
  url: string;
  label: string | null;
}

export interface ContactSocialProfile {
  url: string | null;
  username: string | null;
  service: string | null;
  label: string | null;
}

export interface ContactRelatedName {
  name: string;
  label: string | null;
}

export interface ContactDate {
  date: Date;
  label: string | null;
}

// Search results carry the two contact methods people actually search for
// (phones, emails) inline. The rest of ContactDetails still requires getContact.
export interface ContactSummary extends Contact {
  emails: ContactEmail[];
  phones: ContactPhone[];
}

export interface ContactDetails extends Contact {
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactAddress[];
  urls: ContactURL[];
  socialProfiles: ContactSocialProfile[];
  relatedNames: ContactRelatedName[];
  dates: ContactDate[];
}

export interface Group {
  id: GroupId;
  name: string;
  memberCount: number;
}

export type ContactSortField = "displayName" | "createdAt" | "modifiedAt";

import type { SortOrder } from "../types.ts";

export type { SortOrder };

export interface ListContactsOptions {
  search?: string;
  limit?: number;
  sortBy?: ContactSortField;
  order?: SortOrder;
  groupId?: number;
}

export interface SearchContactsOptions {
  limit?: number;
  groupId?: number;
}

export interface ListGroupsOptions {
  limit?: number;
}
