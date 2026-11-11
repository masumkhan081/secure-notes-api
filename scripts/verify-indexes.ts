import mongoose, { Types } from "mongoose";
import { buildUserPostsPipeline } from "../src/features/posts/post.pipelines.js";
import {
  buildInterestGroupsPipeline,
  buildInterestUsersPipeline,
} from "../src/features/admin/interest.pipelines.js";
import {
  FixtureTracker,
  Note,
  Post,
  User,
  connectTestDatabase,
  disconnectTestDatabase,
  hashPassword,
} from "../test/setup.js";

type ExplainRecord = Record<string, unknown>;

function collectStages(node: unknown, out: string[] = [], indexes: string[] = []): {
  stages: string[];
  indexes: string[];
} {
  if (!node || typeof node !== "object") {
    return { stages: out, indexes };
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectStages(item, out, indexes);
    }
    return { stages: out, indexes };
  }

  const record = node as ExplainRecord;

  if (typeof record.stage === "string") {
    out.push(record.stage);
  }
  if (typeof record.indexName === "string") {
    indexes.push(record.indexName);
  }
  if (Array.isArray(record.indexesUsed)) {
    for (const idx of record.indexesUsed) {
      if (typeof idx === "string") {
        indexes.push(idx);
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === "rejectedPlans" || key === "allPlansExecution") continue;
    collectStages(value, out, indexes);
  }

  return {
    stages: [...new Set(out)],
    indexes: [...new Set(indexes)],
  };
}

function findNestedExecutionStats(explainDoc: ExplainRecord): ExplainRecord | null {
  if (typeof explainDoc.nReturned === "number") {
    return explainDoc;
  }

  const execStats = explainDoc.executionStats as ExplainRecord | undefined;
  if (execStats && typeof execStats.nReturned === "number") {
    return execStats;
  }

  const stages = explainDoc.stages as ExplainRecord[] | undefined;
  if (Array.isArray(stages)) {
    for (const stage of stages) {
      const cursorStage = stage.$cursor as ExplainRecord | undefined;
      const cursorExec = cursorStage?.executionStats as ExplainRecord | undefined;
      if (cursorExec && typeof cursorExec.nReturned === "number") {
        return cursorExec;
      }
    }
  }

  return null;
}

function summarizeExplain(label: string, explainDoc: ExplainRecord) {
  const exec = findNestedExecutionStats(explainDoc);
  const plannerInfo =
    (explainDoc.queryPlanner as ExplainRecord | undefined) ??
    ((explainDoc.stages as ExplainRecord[] | undefined)?.[0]?.$cursor as ExplainRecord | undefined)
      ?.queryPlanner;

  const winSummary = collectStages(plannerInfo ?? explainDoc);
  const execSummary = collectStages(exec ?? explainDoc);

  const stages = [...new Set([...winSummary.stages, ...execSummary.stages])];
  const indexes = [...new Set([...winSummary.indexes, ...execSummary.indexes])];

  // Check top-level aggregation stages (e.g. $unwind, $group, $sort, $lookup).
  const aggStages = (explainDoc.stages as ExplainRecord[] | undefined) ?? [];
  const pipelineStages = aggStages
    .flatMap((s) =>
      Object.keys(s).filter(
        (k) =>
          k.startsWith("$") &&
          k !== "$cursor",
      ),
    );
  const lookupStage = aggStages.find((s) => "$lookup" in s);

  return {
    label,
    stages,
    pipelineStages,
    indexes,
    nReturned: exec?.nReturned ?? null,
    totalKeysExamined: exec?.totalKeysExamined ?? null,
    totalDocsExamined: exec?.totalDocsExamined ?? null,
    executionTimeMillis: exec?.executionTimeMillis ?? null,
    hasBlockingSort: stages.includes("SORT") || pipelineStages.includes("$sort"),
    hasCollectionScan: stages.includes("COLLSCAN"),
    lookupDetails: lookupStage
      ? {
          nReturned:
            typeof lookupStage.nReturned === "number"
              ? lookupStage.nReturned
              : null,
          executionTimeMillisEstimate:
            typeof lookupStage.executionTimeMillisEstimate === "number"
              ? lookupStage.executionTimeMillisEstimate
              : null,
          indexesUsed: Array.isArray(lookupStage.indexesUsed)
            ? lookupStage.indexesUsed
            : null,
          totalDocsExamined:
            typeof lookupStage.totalDocsExamined === "number"
              ? lookupStage.totalDocsExamined
              : null,
          totalKeysExamined:
            typeof lookupStage.totalKeysExamined === "number"
              ? lookupStage.totalKeysExamined
              : null,
        }
      : undefined,
  };
}

async function main(): Promise<void> {
  const fixtures = new FixtureTracker();
  await connectTestDatabase();

  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database handle is unavailable.");
    }

    const buildInfo = await db.command({ buildInfo: 1 });
    const serverVersion =
      typeof buildInfo.version === "string" ? buildInfo.version : "unknown";

    const sharedHash = await hashPassword("SyntheticVerify123!");
    const interestPool = [
      "chess",
      "reading",
      "art & design",
      "astronomy",
      "hiking",
      "cooking",
      "music",
      "photography",
    ];

    const userDocs = [];
    for (let i = 0; i < 24; i += 1) {
      const userInterests =
        i >= 21
          ? []
          : [
              interestPool[i % interestPool.length]!,
              interestPool[(i + 2) % interestPool.length]!,
            ];

      const doc = {
        _id: new Types.ObjectId(),
        name: `Synthetic User ${i}`,
        email: fixtures.email(`explain-u-${i}`),
        passwordHash: sharedHash,
        role: i === 0 ? ("ADMIN" as const) : ("USER" as const),
        interests: [...new Set(userInterests)],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      fixtures.trackUser(doc._id.toString());
      userDocs.push(doc);
    }
    await User.collection.insertMany(userDocs);

    const primaryOwner = userDocs[1]!;
    const secondaryOwner = userDocs[2]!;

    const noteDocs = [];
    for (let i = 0; i < 60; i += 1) {
      const ownerId =
        i < 25
          ? primaryOwner._id
          : i < 45
            ? secondaryOwner._id
            : userDocs[3 + (i % 10)]!._id;
      const doc = {
        _id: new Types.ObjectId(),
        ownerId,
        title: `${fixtures.runId} Note ${i}`,
        content: `Synthetic note content ${i}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      fixtures.trackNote(doc._id.toString());
      noteDocs.push(doc);
    }
    await Note.collection.insertMany(noteDocs);

    const postDocs = [];
    for (let i = 0; i < 60; i += 1) {
      const authorId =
        i < 25
          ? primaryOwner._id
          : i < 45
            ? secondaryOwner._id
            : userDocs[3 + (i % 10)]!._id;
      const doc = {
        _id: new Types.ObjectId(),
        authorId,
        title: `${fixtures.runId} Post ${i}`,
        content: `Synthetic post content ${i}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      fixtures.trackPost(doc._id.toString());
      postDocs.push(doc);
    }
    await Post.collection.insertMany(postDocs);

    const primaryNotes = noteDocs
      .filter((n) => n.ownerId.equals(primaryOwner._id))
      .sort((a, b) => b._id.toString().localeCompare(a._id.toString()));
    const noteCursor = primaryNotes[9]!._id;

    const primaryPosts = postDocs
      .filter((p) => p.authorId.equals(primaryOwner._id))
      .sort((a, b) => b._id.toString().localeCompare(a._id.toString()));
    const postCursor = primaryPosts[9]!._id.toString();

    const targetInterest = "chess";
    const interestMembers = userDocs
      .filter((u) => u.interests.includes(targetInterest))
      .sort((a, b) => b._id.toString().localeCompare(a._id.toString()));
    const memberCursor = interestMembers[2]?._id.toString();

    const counts = {
      users: await User.collection.countDocuments(),
      notes: await Note.collection.countDocuments(),
      posts: await Post.collection.countDocuments(),
    };

    const indexes = {
      users: await User.collection.indexes(),
      notes: await Note.collection.indexes(),
      posts: await Post.collection.indexes(),
    };

    const explains = [
      summarizeExplain(
        "1. Email lookup (login)",
        (await User.collection
          .find({ email: primaryOwner.email })
          .limit(1)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "2a. Owner-scoped note list (no cursor)",
        (await Note.collection
          .find({ ownerId: primaryOwner._id })
          .sort({ _id: -1 })
          .limit(11)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "2b. Owner-scoped note list (with cursor)",
        (await Note.collection
          .find({ ownerId: primaryOwner._id, _id: { $lt: noteCursor } })
          .sort({ _id: -1 })
          .limit(11)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "3a. Admin user list",
        (await User.collection
          .find({})
          .sort({ _id: -1 })
          .limit(11)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "3b. Admin all-notes list",
        (await Note.collection
          .find({})
          .sort({ _id: -1 })
          .limit(11)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "4a. Individual note lookup (_id + ownerId)",
        (await Note.collection
          .find({ _id: primaryNotes[0]!._id, ownerId: primaryOwner._id })
          .limit(1)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "4b. Individual user lookup (_id)",
        (await User.collection
          .find({ _id: primaryOwner._id })
          .limit(1)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "5. Public posts list",
        (await Post.collection
          .find({})
          .sort({ _id: -1 })
          .limit(11)
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "6. Selected-interest members",
        (await User.collection
          .aggregate(buildInterestUsersPipeline(targetInterest, 10, memberCursor))
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "7. User-post $lookup aggregation",
        (await User.collection
          .aggregate(
            buildUserPostsPipeline(primaryOwner._id.toString(), 10, postCursor),
          )
          .explain("executionStats")) as ExplainRecord,
      ),
      summarizeExplain(
        "8. Full interest grouping",
        (await User.collection
          .aggregate(buildInterestGroupsPipeline(10))
          .explain("executionStats")) as ExplainRecord,
      ),
    ];

    console.log(
      JSON.stringify(
        {
          database: db.databaseName,
          serverVersion,
          counts,
          indexes,
          explains,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await fixtures.cleanup();
    } finally {
      await disconnectTestDatabase();
    }
  }
}

main().catch((error: unknown) => {
  console.error(
    "Index verification failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
