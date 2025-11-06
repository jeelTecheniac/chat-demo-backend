import mongoose, { Schema, model, Types } from "mongoose";

const organizationSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    creator: {
      type: Types.ObjectId,
      required: true,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

export const Organization =
  mongoose.models.Organization || model("Organization", organizationSchema);
