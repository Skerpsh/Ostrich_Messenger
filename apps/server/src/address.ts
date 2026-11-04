import { isIPv6 } from "node:net";

// What limits count a client by. One IPv6 customer usually has a whole /64,
// so counting each address apart would let them change it at every request.
export function addressKey(ip: string) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);

  if (mapped) {
    return mapped[1];
  }

  if (!isIPv6(ip)) {
    return ip;
  }

  const [head, tail] = ip.split("%")[0].split("::");
  const start = head ? head.split(":") : [];
  const end = tail ? tail.split(":") : [];
  const groups = [...start, ...Array<string>(8 - start.length - end.length).fill("0"), ...end];

  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}
