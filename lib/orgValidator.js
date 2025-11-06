import mongoose from "mongoose";
import { User } from "../models/user.js";

const toIdStrings = (arr = []) => arr.map((id) => id.toString());

const intersectionNonEmpty = (a = [], b = []) => {
  const setA = new Set(toIdStrings(a));
  for (const x of b) if (setA.has(x.toString())) return true;
  return false;
};

// Returns true if both users share at least one organization
export const usersShareOrganization = async (userIdA, userIdB) => {
  if (!mongoose.isValidObjectId(userIdA) || !mongoose.isValidObjectId(userIdB))
    return false;

  const [a, b] = await Promise.all([
    User.findById(userIdA).select("joinedOrganizations"),
    User.findById(userIdB).select("joinedOrganizations"),
  ]);
  if (!a || !b) return false;
  return intersectionNonEmpty(a.joinedOrganizations, b.joinedOrganizations);
};

// Returns true if every member shares at least one org with the reference user
export const allMembersShareOrgWith = async (
  referenceUserId,
  memberIds = []
) => {
  if (!mongoose.isValidObjectId(referenceUserId)) return false;

  const users = await User.find({ _id: { $in: memberIds } }).select(
    "joinedOrganizations"
  );
  const ref = await User.findById(referenceUserId).select(
    "joinedOrganizations"
  );
  if (!ref || users.length !== memberIds.length) return false;

  return users.every((u) =>
    intersectionNonEmpty(ref.joinedOrganizations, u.joinedOrganizations)
  );
};
