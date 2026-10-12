---
test: "node --test"
---
# A discount came out a cent short

A customer bought three notebooks at $19.99 in a week with 15% off books. The receipt showed the
discount as `-$8.99`. 15% of $59.97 is 899.55 cents, and the project rule (README) is that every
percentage amount rounds half up to the nearest cent, so it should have been `-$9.00`.

Find the cause and fix it so the rule holds. Add a test that would have caught it.
