const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const User = require("../models/User");

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    done(null, await User.findById(id));
  } catch (err) {
    done(err);
  }
});

passport.use(
  "local.signup",
  new LocalStrategy(
    { usernameField: "email", passwordField: "password", passReqToCallback: true },
    async (req, email, password, done) => {
      try {
        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) return done(null, false, { message: "Email already exists" });
        if (password !== req.body.password2) {
          return done(null, false, { message: "Passwords do not match" });
        }
        const user = new User({ username: req.body.name, email });
        user.password = user.encryptPassword(password);
        await user.save();
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.use(
  "local.signin",
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email: email.toLowerCase() });
        // Same message for both cases so attackers can't tell which emails exist.
        if (!user || !user.validPassword(password)) {
          return done(null, false, { message: "Invalid email or password" });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

module.exports = passport;
