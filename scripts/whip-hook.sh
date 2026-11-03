#!/bin/sh
# Prints the agent's board line, for a Claude Code or Codex hook to add to
# the agent's context. It never blocks the agent: if whip-server can't be
# reached, it says so and exits 0, because one outage shouldn't stop a night.
# Needs WHIP_URL, WHIP_AGENT_ID and WHIP_AGENT_TOKEN in the environment.
if [ -z "$WHIP_URL" ] || [ -z "$WHIP_AGENT_ID" ] || [ -z "$WHIP_AGENT_TOKEN" ]; then
  echo "Agent Whipper: set WHIP_URL, WHIP_AGENT_ID and WHIP_AGENT_TOKEN to see your board line."
  exit 0
fi
if line=$(curl -fsS --max-time 5 -H "Authorization: Bearer $WHIP_AGENT_TOKEN" "$WHIP_URL/agents/$WHIP_AGENT_ID" 2>&1); then
  echo "$line"
else
  echo "Agent Whipper: whip-server didn't answer ($line). Carry on with your current step, and keep your blurb current."
fi
exit 0
