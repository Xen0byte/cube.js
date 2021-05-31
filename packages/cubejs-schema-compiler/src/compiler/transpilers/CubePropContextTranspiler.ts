import * as t from '@babel/types';
import R from 'ramda';
import { TranspilerInterface, TraverseObject } from './transpiler.interface';
import type { CubeSymbols } from '../CubeSymbols';
import type { CubeDictionary } from '../CubeDictionary';
import { NodePath } from '@babel/traverse';

export class CubePropContextTranspiler implements TranspilerInterface {
  public constructor(
    protected readonly cubeSymbols: CubeSymbols,
    protected readonly cubeDictionary: CubeDictionary,
  ) {
  }

  public traverseObject(): TraverseObject {
    return {
      CallExpression: (path) => {
        if (t.isIdentifier(path.node.callee)) {
          const args = path.get('arguments');
          if (['view', 'cube'].includes(path.node.callee.name)) {
            if (args && args[args.length - 1]) {
              const cubeName = args[0].node.type === 'StringLiteral' && args[0].node.value ||
                args[0].node.type === 'TemplateLiteral' &&
                args[0].node.quasis.length &&
                args[0].node.quasis[0].value.cooked;
              args[args.length - 1].traverse(this.sqlAndReferencesFieldVisitor(cubeName));
              args[args.length - 1].traverse(
                this.knownIdentifiersInjectVisitor('extends', name => this.cubeDictionary.resolveCube(name))
              );
            }
          } else if (path.node.callee.name === 'context') {
            args[args.length - 1].traverse(this.sqlAndReferencesFieldVisitor(null));
          }
        }
      }
    };
  }

  protected sqlAndReferencesFieldVisitor(cubeName) {
    const field = /^(sql|measureReferences|dimensionReferences|segmentReferences|timeDimensionReference|timeDimensions|rollupReferences|drillMembers|drillMemberReferences|contextMembers|columns)$/;
    const resolveSymbol = name => this.cubeSymbols.resolveSymbol(cubeName, name) || this.cubeSymbols.isCurrentCube(name);

    return {
      ObjectProperty: (path) => {
        if (path.node.key.type === 'Identifier') {
          const isSimple = path.node.key.name.match(field);
          const isComplex = path.node.key.name.match(/^(dimensions|segments|rollups|measures)$/) && path.parentPath.parent.type !== 'CallExpression';

          if (isSimple || isComplex) {
            const knownIds = this.collectKnownIdentifiers(
              resolveSymbol,
              path.get('value')
            );
            path.get('value').replaceWith(
              t.arrowFunctionExpression(
                knownIds.map(i => t.identifier(i)),
                // @todo Replace any with assert expression
                <any>path.node.value,
                false
              )
            );
          }
        }
      }
    };
  }

  protected knownIdentifiersInjectVisitor(field: RegExp|string, resolveSymbol: (name: string) => void): TraverseObject {
    return {
      ObjectProperty: (path) => {
        if (path.node.key.type === 'Identifier' && path.node.key.name.match(field)) {
          const knownIds = this.collectKnownIdentifiers(
            resolveSymbol,
            path.get('value')
          );
          path.get('value').replaceWith(
            t.arrowFunctionExpression(
              knownIds.map(i => t.identifier(i)),
              // @todo Replace any with assert expression
              <any>path.node.value,
              false
            )
          );
        }
      }
    };
  }

  protected collectKnownIdentifiers(resolveSymbol, path: NodePath) {
    const identifiers = [];

    if (path.node.type === 'Identifier') {
      this.matchAndPushIdentifier(path, resolveSymbol, identifiers);
    }

    path.traverse({
      Identifier: (p) => {
        this.matchAndPushIdentifier(p, resolveSymbol, identifiers);
      }
    });

    return R.uniq(identifiers);
  }

  protected matchAndPushIdentifier(path, resolveSymbol, identifiers) {
    if (
      (!path.parent ||
        (path.parent.type !== 'MemberExpression' || path.parent.type === 'MemberExpression' && path.key !== 'property')
      ) &&
      resolveSymbol(path.node.name)
    ) {
      identifiers.push(path.node.name);
    }
  }
}
