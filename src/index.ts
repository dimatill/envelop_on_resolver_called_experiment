import { createServer } from "http";
import { envelop, Plugin, useSchema } from "@envelop/core";
import { makeExecutableSchema } from "@graphql-tools/schema";

// schema
const typeDefs = `
  type Test {
    calculatedField: String!
    dbField: String!
  }

  type Query {
    test: Test!
  }
`;

// resolvers
const resolvers = {
  Query: {
    test: () =>
      new Promise((resolve) => {
        // dbField is originally present in the db
        setTimeout(() => resolve({ dbField: "dbField" }), 100);
      }),
  },
  Test: {
    // calculatedField is calculated
    calculatedField: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve("calculatedField"), 200);
      }),
  },
};

// this function resolves field promise and awaits for all other field promises to be resolved
// and adds results to the root object
async function onResult(result, resolveFn, context, root, parentTypeName) {
  resolveFn(result);
  const keys = Object.keys(context.__authMetadata).filter(
    (key) => context.__authMetadata[key].parentTypeName === parentTypeName
  );
  const values = await Promise.all(
    keys.map(async (key) => await context.__authMetadata[key].promise)
  );
  const rootFields = keys.reduce((result, key, index) => {
    result[key] = values[index].result;
    return result;
  }, {} as Record<string, any>);
  Object.assign(root, rootFields);
}

const envelopPlugin = (): Plugin<{ __authMetadata: Record<string, any> }> => {
  return {
    onExecute({ args }) {
      return {
        onResolverCalled({ root, context, info }) {
          // common code for all onResolverCalled
          /**************************************/
          let resolveFn: any;
          context.__authMetadata = context.__authMetadata || {};
          context.__authMetadata[info.fieldName] = {
            promise: new Promise((resolve) => (resolveFn = resolve)),
            parentTypeName: info.path.typename,
          };
          /**************************************/

          if (info.fieldName === "calculatedField") {
            // rule for calculatedField
            console.log("calculatedField::onResolverCalled::before", arguments);
            return async function (result: any) {
              // common code for all onResolverCalled return function
              await onResult(
                result,
                resolveFn,
                context,
                root,
                info.path.typename
              );
              // rule for calculatedField
              console.log(
                "calculatedField::onResolverCalled::after",
                arguments,
                context
              );
            };
          }
          if (info.fieldName === "dbField") {
            // rule for dbField
            console.log("dbField::onResolverCalled::before", arguments);
            return async function (result: any) {
              // common code for all onResolverCalled return function
              await onResult(
                result,
                resolveFn,
                context,
                root,
                info.path.typename
              );

              // rule for dbField
              // here we can get calculated field value right from the root
              console.log(
                "dbField::onResolverCalled::after::calculatedField",
                root.calculatedField
              );
              console.log(
                "dbField::onResolverCalled::after",
                arguments,
                context
              );
            };
          }
          return undefined;
        },
      };
    },
  };
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

const getEnveloped = envelop({
  plugins: [useSchema(schema), envelopPlugin()],
});

const server = createServer((req, res) => {
  const { parse, validate, execute, schema } = getEnveloped({
    req,
  });
  let payload = "";

  req.on("data", (chunk) => {
    payload += chunk.toString();
  });

  req.on("end", () => {
    const { query, variables, operationName } = JSON.parse(payload);
    const document = parse(query);
    const validationErrors = validate(schema, document);

    if (validationErrors.length > 0) {
      res.end(
        JSON.stringify({
          errors: validationErrors,
        })
      );

      return;
    }

    void (async () => {
      try {
        const result = await execute({
          operationName,
          document,
          schema,
          variableValues: variables,
          contextValue: {},
        });

        res.end(JSON.stringify(result));
      } catch (error) {
        res.end(
          JSON.stringify({
            errors: [error],
          })
        );
      }
    })();
  });
});

server.listen(4000);
