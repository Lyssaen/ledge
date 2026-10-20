// Every phone message is padded to a size tier before sealing, so the relay sees a tier and not an exact length.
// The rule lives in @ledge/protocol, shared with the phone.
export { padPlain as pad } from '@ledge/protocol';
