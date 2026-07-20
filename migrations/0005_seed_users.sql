-- Seeds the initial staff accounts with temporary passwords. Everyone must change their
-- password on first login (must_change_password = 1) -- see functions/api/auth/change-password.ts.
-- Plaintext temp passwords are NOT stored here; they were generated once and handed out directly.

INSERT INTO users (id, name, username, password_hash, password_salt, must_change_password, failed_attempts, locked_until, created_at, updated_at) VALUES
  ('2142be1a-da43-4f98-9dbc-660b376f4ca7', 'Alyson', 'alyson', 'c8b168ca5eaeaa130d7871c05f72db0fa33908a0e59938a0dcd94eee374b5e36', '12ab6f3d56d6498f966a1f8334dd749a', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z'),
  ('3cf4ed80-5135-4ad2-85a5-819da6a34a91', 'Christine', 'christine', 'e3e2a7a07e1a649cc8e0b60d6ef501a064ec9d284f53ca79a6b49a12b2bc3a53', '4b2006bd494ad4d5b01e21ea3f5768ff', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z'),
  ('b2be8b69-e3a5-4eb6-b9a5-ad8f930fc22b', 'Imad', 'imad', '735d1cf5e96765bbcd9bdccbab06c241c9f4ebe5167406cd0d05c8fa8a8119c9', 'fac2f1df46545477a8bf0b7ed7ddaa2e', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z'),
  ('4ce36e1d-6d05-4b6e-a927-b04fce493aaa', 'Jason', 'jason', '7cabf790fd4b77ccee81a3ba211d0e1482e442b200ceb42c416d629cf2fbbc54', '1b1a2092bda79ca304d092f22aeba1ce', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z'),
  ('b14e9405-851e-46bc-b801-c2947e64ae0a', 'Jen', 'jen', 'f340ca78947ece800e2be2f50860a22804f70fc4887aebfc649743d0ac5d5bd2', '2f9cff5490f8b11a7aaa1ef7eedc477f', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z'),
  ('5e8b8dcd-82ba-4e91-a750-b09696b993a6', 'Karam', 'karam', 'ef91b58fda7576e88816ac6f0756be00df2ec48aad2b46e739c99cb289be9908', 'b0c5a84cefb1ac8e0958743846e90265', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z'),
  ('e1ba3073-d7fe-4920-b99e-f07459eb1a3a', 'Brenda', 'brenda', '2c05cb810d967a8577495c30f9cb3f144e84a8d50ec2f9388228a1b76af12187', 'f0a9cfcd4c5b5374b949c072aaabc767', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z'),
  ('a33e2d2e-75e0-4497-9459-317a8e77226e', 'Brandon', 'brandon', '5e318688cb944e426eae188201b2662f426d4432480abdd7f3b92389db506231', 'bd038b9e7af91d02e1d00317c6ca5a13', 1, 0, NULL, '2026-07-20T13:14:33.396Z', '2026-07-20T13:14:33.396Z');
