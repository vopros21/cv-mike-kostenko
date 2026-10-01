---
title: Hello, world
date: 2026-10-01
summary: Why this blog exists, what I plan to write about, and a quick tour of the formatting it supports.
category: tech
draft: true
---

This is the first post on the blog. I'll write here about **Java**, testing, the occasional side project, and life in Porto.

## What to expect

A few topics I have in mind:

- Making slow unit test suites fast again
- Working in a large, long-lived Java/Swing codebase
- Notes from building small internal tools
- Learning Portuguese, slowly

The CV itself lives on the [main page](../index.html), and every post is also available as plain Markdown for tools and LLMs.

## Code

Inline code looks like `List.of(1, 2, 3)`. A fenced block:

```java
record Booking(String user, LocalDate day, Slot slot) {
    boolean overlaps(Booking other) {
        return day.equals(other.day) && (slot == Slot.FULL || other.slot == Slot.FULL || slot == other.slot);
    }
}
```

### A quote

> Make it work, make it right, make it fast.
>
> — Kent Beck

### A table

| Slot | Time          | Notes                  |
|------|---------------|------------------------|
| AM   | 08:00 – 13:00 | Morning half-day       |
| PM   | 13:00 – 19:00 | Afternoon half-day     |
| Full | 08:00 – 19:00 | Blocks both half-days  |

### An image

![A small diagram: Markdown post, build script, static HTML](images/hello-world.svg)

That's it for now. Thanks for reading.
