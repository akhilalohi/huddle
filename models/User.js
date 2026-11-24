const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["customer", "admin"], default: "customer" },
  },
  { timestamps: true }
);

// Hash with bcrypt (10 salt rounds) - the plain password is never stored.
userSchema.methods.encryptPassword = function (plain) {
  return bcrypt.hashSync(plain, bcrypt.genSaltSync(10));
};

userSchema.methods.validPassword = function (candidate) {
  if (!this.password) return false;
  return bcrypt.compareSync(candidate, this.password);
};

module.exports = mongoose.model("User", userSchema);
