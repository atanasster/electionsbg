export type CanonicalPartyHistory = {
  election: string;
  partyNum: number;
  nickName: string;
  name?: string;
};

export type CanonicalParty = {
  id: string; // stable slug (URL-safe ASCII)
  displayName: string; // label to show (latest election's nickName)
  color: string;
  history: CanonicalPartyHistory[];
};

export type CanonicalPartiesIndex = {
  parties: CanonicalParty[];
  // nickName → canonicalId (for any nickName that appeared in any election)
  byNickName: Record<string, string>;
};
