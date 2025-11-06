import { compare } from "bcrypt";
import { NEW_REQUEST, REFETCH_CHATS } from "../constants/events.js";
import { getOtherMember } from "../lib/helper.js";
import { TryCatch } from "../middlewares/error.js";
import { Chat } from "../models/chat.js";
import { Request } from "../models/request.js";
import { User } from "../models/user.js";
import { Organization } from "../models/organization.js";
import mongoose from "mongoose";
import {
  cookieOptions,
  emitEvent,
  sendToken,
  uploadFilesToCloudinary,
} from "../utils/features.js";
import { ErrorHandler } from "../utils/utility.js";
import { usersShareOrganization } from "../lib/orgValidator.js";
// Create a new user and save it to the database and save token in cookie
const newUser = TryCatch(async (req, res, next) => {
  const {
    name,
    username,
    password,
    bio,
    Organization: organizationId,
  } = req.body;

  const file = req.file;

  if (!file) return next(new ErrorHandler("Please Upload Avatar"));

  const result = await uploadFilesToCloudinary([file]);

  const avatar = {
    public_id: result[0].public_id,
    url: result[0].url,
  };

  let joinedOrganizations = [];
  if (organizationId && String(organizationId).trim() !== "") {
    if (!mongoose.isValidObjectId(organizationId)) {
      return next(new ErrorHandler("Invalid Organization ID", 400));
    }
    const organizationResult = await Organization.findById(organizationId);
    if (!organizationResult) {
      return next(new ErrorHandler("Organization not found", 404));
    }
    joinedOrganizations = [organizationId];
  }

  const user = await User.create({
    name,
    bio,
    username,
    password,
    avatar,
    joinedOrganizations,
  });

  sendToken(res, user, 201, "User created");
});

// Login user and save token in cookie
const login = TryCatch(async (req, res, next) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username }).select("+password");

  if (!user) return next(new ErrorHandler("Invalid Username or Password", 404));

  const isMatch = await compare(password, user.password);

  if (!isMatch)
    return next(new ErrorHandler("Invalid Username or Password", 404));

  sendToken(res, user, 200, `Welcome Back, ${user.name}`);
});
const getMyProfile = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);

  if (!user) return next(new ErrorHandler("User not found", 404));

  res.status(200).json({
    success: true,
    user,
  });
});

const logout = TryCatch(async (req, res) => {
  return res
    .status(200)
    .cookie("chattu-token", "", { ...cookieOptions, maxAge: 0 })
    .json({
      success: true,
      message: "Logged out successfully",
    });
});

const searchUser = TryCatch(async (req, res) => {
  const { name = "" } = req.query;

  // Finding the current user's organizations
  const currentUser = await User.findById(req.user).select(
    "joinedOrganizations"
  );

  // Check if the user has joined any organizations
  if (currentUser.joinedOrganizations.length === 0) {
    return res.status(400).json({
      success: false,
      message: "You have not joined any organizations yet.",
    });
  }

  // Assuming that the user can only search for other users in their organizations
  // You can choose the first organization, or you can customize this logic to allow multiple orgs
  const organizationId = currentUser.joinedOrganizations[0];

  // Finding all the user's chats (excluding group chats)
  const myChats = await Chat.find({ groupChat: false, members: req.user });

  // Extracting all users from the user's chats (friends or people they have chatted with)
  const allUsersFromMyChats = myChats.flatMap((chat) => chat.members);
  const val = new mongoose.Types.ObjectId(req.user);

  if (allUsersFromMyChats.length === 0) allUsersFromMyChats.push(val);

  console.log(allUsersFromMyChats);

  // Find all users within the same organization as the current user
  const allUsersExceptMeAndFriends = await User.find({
    _id: { $nin: allUsersFromMyChats },
    name: { $regex: name, $options: "i" },
    joinedOrganizations: { $in: [organizationId] }, // Ensure users are in the same organization
  });

  // Prepare the response with necessary user details
  const users = allUsersExceptMeAndFriends.map(({ _id, name, avatar }) => ({
    _id,
    name,
    avatar: avatar.url,
  }));

  return res.status(200).json({
    success: true,
    users,
  });
});

const sendFriendRequest = TryCatch(async (req, res, next) => {
  const { userId } = req.body;
  console.log("Send Friend Request to User ID:", userId);

  // Block cross-organization requests
  const sameOrg = await usersShareOrganization(req.user, userId);
  console.log("Users share organization:", sameOrg);
  if (!sameOrg)
    return next(
      new ErrorHandler(
        "You can only send friend requests within your organization",
        403
      )
    );

  const request = await Request.findOne({
    $or: [
      { sender: req.user, receiver: userId },
      { sender: userId, receiver: req.user },
    ],
  });

  if (request) return next(new ErrorHandler("Request already sent", 400));

  await Request.create({
    sender: req.user,
    receiver: userId,
  });

  emitEvent(req, NEW_REQUEST, [userId]);

  return res.status(200).json({
    success: true,
    message: "Friend Request Sent",
  });
});

const acceptFriendRequest = TryCatch(async (req, res, next) => {
  const { requestId, accept } = req.body;

  const request = await Request.findById(requestId)
    .populate("sender", "name")
    .populate("receiver", "name");

  if (!request) return next(new ErrorHandler("Request not found", 404));

  if (request.receiver._id.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to accept this request", 401)
    );

  if (!accept) {
    await request.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Friend Request Rejected",
    });
  }

  const members = [request.sender._id, request.receiver._id];

  // Ensure both are in the same organization before creating a direct chat
  const sameOrg = await usersShareOrganization(members[0], members[1]);
  if (!sameOrg)
    return next(
      new ErrorHandler(
        "You can only create chats within your organization",
        403
      )
    );

  await Promise.all([
    Chat.create({
      members,
      name: `${request.sender.name}-${request.receiver.name}`,
    }),
    request.deleteOne(),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Friend Request Accepted",
    senderId: request.sender._id,
  });
});

const getMyNotifications = TryCatch(async (req, res) => {
  const requests = await Request.find({ receiver: req.user }).populate(
    "sender",
    "name avatar"
  );

  const allRequests = requests.map(({ _id, sender }) => ({
    _id,
    sender: {
      _id: sender._id,
      name: sender.name,
      avatar: sender.avatar.url,
    },
  }));

  return res.status(200).json({
    success: true,
    allRequests,
  });
});

const getMyFriends = TryCatch(async (req, res) => {
  const chatId = req.query.chatId;

  const chats = await Chat.find({
    members: req.user,
    groupChat: false,
  }).populate("members", "name avatar");

  const friends = chats.map(({ members }) => {
    const otherUser = getOtherMember(members, req.user);

    return {
      _id: otherUser._id,
      name: otherUser.name,
      avatar: otherUser.avatar.url,
    };
  });

  if (chatId) {
    const chat = await Chat.findById(chatId);

    const availableFriends = friends.filter(
      (friend) => !chat.members.includes(friend._id)
    );

    return res.status(200).json({
      success: true,
      friends: availableFriends,
    });
  } else {
    return res.status(200).json({
      success: true,
      friends,
    });
  }
});

const createOrganization = TryCatch(async (req, res, next) => {
  const { organizationName } = req.body;

  // Check if the organization name is provided and is not empty
  if (!organizationName || organizationName.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Organization name is required and cannot be empty.",
    });
  }

  try {
    // Create the organization
    const organization = await Organization.create({
      name: organizationName,
      creator: req.user,
    });

    // Add the user (creator) to the joinedOrganizations array
    await User.findByIdAndUpdate(req.user, {
      $push: { joinedOrganizations: organization._id },
    });

    // Respond with the created organization
    return res.status(201).json({
      success: true,
      organization,
    });
  } catch (error) {
    console.error("Error creating organization:", error);
    return res.status(500).json({
      success: false,
      message: "There was an error creating the organization.",
    });
  }
});

const getMyOrganizations = TryCatch(async (req, res, next) => {
  const organizations = await Organization.find({ creator: req.user }).sort({
    createdAt: -1,
  });
  res.status(200).json({ success: true, organizations });
});

const getJoinedOrganizations = TryCatch(async (req, res, next) => {
  const joinedOrganizations = await User.findById(req.user).populate(
    "joinedOrganizations"
  );
  console.log(joinedOrganizations);
  res.status(200).json({
    success: true,
    organizations: joinedOrganizations.joinedOrganizations,
  });
});

export {
  acceptFriendRequest,
  getMyFriends,
  getMyNotifications,
  getMyProfile,
  login,
  logout,
  newUser,
  searchUser,
  sendFriendRequest,
  createOrganization,
  getMyOrganizations,
  getJoinedOrganizations,
};
