const { check, validationResult } = require("express-validator");
const payment = require("../lib/payment");
const pricing = require("../lib/pricing");
const { parseDateTimeLocal } = require("../lib/helpers");

/**
 * Server-side validation rules (Experiment 4). The browser also validates with
 * HTML5 attributes, but the server never trusts the browser.
 */
const signUpRules = () => [
  check("name", "Name is required").trim().notEmpty(),
  check("email", "Please enter a valid email address").trim().isEmail(),
  check("password", "Password must be at least 8 characters and contain a letter and a number")
    .isLength({ min: 8 })
    .matches(/[A-Za-z]/)
    .matches(/\d/),
  check("password2", "Passwords do not match").custom((v, { req }) => v === req.body.password),
];

const signInRules = () => [
  check("email", "Please enter a valid email address").trim().isEmail(),
  check("password", "Password is required").notEmpty(),
];

const contactRules = () => [
  check("name", "Please enter your name").trim().notEmpty(),
  check("email", "Please enter a valid email address").trim().isEmail(),
  check("message", "Please enter a message of at least 10 characters").trim().isLength({ min: 10 }),
];

const productRules = () => [
  check("title", "Title is required").trim().notEmpty(),
  check("productCode", "Product code is required").trim().notEmpty(),
  check("description", "Description is required").trim().notEmpty(),
  check("price", "Price must be a number greater than 0").isFloat({ gt: 0 }),
  check("category", "Pick a category").isMongoId(),
];

const categoryRules = () => [check("title", "Category name is required").trim().notEmpty()];

const cardRules = () => [
  check("cardName", "Name on card is required").trim().notEmpty(),
  check("cardNumber", "Enter a valid card number")
    .custom((v) => payment.luhnValid(v)),
  check("expiry", "Enter a valid expiry (MM/YY) that is not in the past")
    .custom((v) => payment.expiryValid(v)),
  check("cvc", "CVC must be 3 or 4 digits").matches(/^\d{3,4}$/),
  check("address", "Delivery address must be at least 10 characters").trim().isLength({ min: 10 }),
];

const joinDealRules = () => [
  check("qty", "Quantity must be a whole number").isInt({ min: 1 }),
  ...cardRules(),
];

const dealRules = () => [
  check("product", "Pick a product").isMongoId(),
  check("endsAt", "Pick an end date and time in the future").custom((v, { req }) => {
    const d = parseDateTimeLocal(v, req.body.tzOffset);
    return !isNaN(d) && d > new Date();
  }),
  check("maxParticipants", "Max participants must be 0 or more").optional({ checkFalsy: true }).isInt({ min: 0 }),
  check("maxQtyPerPerson", "Max quantity per person must be at least 1").isInt({ min: 1 }),
  check("tiers").custom((_, { req }) => {
    const errors = pricing.validateTiers(parseTiers(req.body));
    if (errors.length) throw new Error(errors[0]);
    return true;
  }),
];

/** Turn the form's tier rows (tierMin[] / tierDiscount[]) into tier objects. */
function parseTiers(body) {
  const mins = [].concat(body.tierMin || []);
  const discs = [].concat(body.tierDiscount || []);
  const tiers = [];
  mins.forEach((m, i) => {
    if (String(m).trim() === "" && String(discs[i] || "").trim() === "") return;
    tiers.push({ minParticipants: Number(m), discountPercent: Number(discs[i]) });
  });
  return tiers;
}

/** Collect validation errors into a single list of messages. */
function errorsOf(req) {
  const result = validationResult(req);
  return result.isEmpty() ? [] : [...new Set(result.array().map((e) => e.msg))];
}

module.exports = {
  signUpRules,
  signInRules,
  contactRules,
  productRules,
  categoryRules,
  joinDealRules,
  cardRules,
  dealRules,
  parseTiers,
  errorsOf,
};
